import { spawn } from 'child_process';
import { Octokit } from '@octokit/rest';
import * as vscode from 'vscode';
import {
  GitHubRepo,
  GitHubPR,
  GitHubComment,
  GitHubReview,
  CacheEntry,
  RateLimitInfo,
  GitHubServiceConfig,
  PRReference,
} from '../types/github';

/**
 * GitHub API service with rate limiting and caching.
 *
 * Implements privacy-first GitHub integration with:
 * - Optional authentication (works without token)
 * - Aggressive caching to minimize API calls (5-min TTL for PR data)
 * - Rate limit tracking with exponential backoff
 * - Graceful degradation on errors
 * - Secure token storage using VS Code secret storage
 *
 * Design philosophy:
 * - Local-first: Cache aggressively, network is optional
 * - Privacy-first: Token is opt-in, clear docs about scope
 * - Resilient: Never crash the extension due to API errors
 */
export class GitHubService {
  private octokit: Octokit;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private config: Required<GitHubServiceConfig>;
  private rateLimitInfo: RateLimitInfo | null = null;
  private context: vscode.ExtensionContext;

  /**
   * Creates a new GitHub service instance.
   *
   * @param context - VS Code extension context for secret storage
   * @param config - Configuration options (token, TTLs, retry settings)
   */
  constructor(context: vscode.ExtensionContext, config?: GitHubServiceConfig) {
    this.context = context;
    this.config = {
      token: config?.token ?? undefined,
      cacheTTL: config?.cacheTTL ?? 5 * 60 * 1000, // 5 minutes
      staticCacheTTL: config?.staticCacheTTL ?? 60 * 60 * 1000, // 1 hour
      maxRetries: config?.maxRetries ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
    };

    // initialize octokit (with or without auth)
    this.octokit = this.config.token ? new Octokit({ auth: this.config.token }) : new Octokit();
  }

  /**
   * Updates the GitHub token and reinitializes the Octokit client.
   * Token is stored securely in VS Code secret storage.
   *
   * @param token - GitHub personal access token (optional)
   */
  async setToken(token: string | undefined): Promise<void> {
    this.config.token = token;

    if (token) {
      await this.context.secrets.store('github.token', token);
      this.octokit = new Octokit({ auth: token });
      console.log('GitHubService: Token configured (authenticated mode)');
    } else {
      await this.context.secrets.delete('github.token');
      this.octokit = new Octokit();
      console.log('GitHubService: Token removed (unauthenticated mode)');
    }

    // clear cache on token change
    this.cache.clear();
  }

  /**
   * Loads the GitHub token from VS Code secret storage.
   * Called during extension activation.
   */
  async loadToken(): Promise<void> {
    const token = await this.context.secrets.get('github.token');
    if (token) {
      this.config.token = token;
      this.octokit = new Octokit({ auth: token });
      console.log('GitHubService: Token loaded from secret storage');
    }
  }

  /**
   * Detects GitHub repository from git remote URL.
   * Supports both HTTPS and SSH URL formats.
   *
   * @param workspacePath - Absolute path to workspace folder
   * @returns Repository info or null if not a GitHub repo
   */
  async detectGitHubRepo(workspacePath: string): Promise<GitHubRepo | null> {
    // check cache first (static data, long TTL)
    const cacheKey = `repo:${workspacePath}`;
    const cached = this.getCached<GitHubRepo | null>(cacheKey, this.config.staticCacheTTL);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const remoteUrl = await this.getGitRemoteUrl(workspacePath);
      if (!remoteUrl) {
        this.setCached(cacheKey, null);
        return null;
      }

      const repo = this.parseGitHubUrl(remoteUrl);
      this.setCached(cacheKey, repo);
      return repo;
    } catch (error) {
      console.error('GitHubService: Error detecting GitHub repo:', error);
      this.setCached(cacheKey, null);
      return null;
    }
  }

  /**
   * Fetches pull request data from GitHub API.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns PR data or null on error
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPR | null> {
    const cacheKey = `pr:${owner}/${repo}#${prNumber}`;
    const cached = this.getCached<GitHubPR>(cacheKey, this.config.cacheTTL);
    if (cached !== undefined) {
      return cached;
    }

    try {
      await this.checkRateLimit();

      const { data } = await this.retryWithBackoff(async () => {
        return await this.octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });
      });

      const pr: GitHubPR = {
        number: data.number,
        title: data.title,
        body: data.body,
        state: data.state as 'open' | 'closed',
        html_url: data.html_url,
        created_at: data.created_at,
        updated_at: data.updated_at,
        merged_at: data.merged_at,
        user: {
          login: data.user?.login ?? 'unknown',
          avatar_url: data.user?.avatar_url ?? '',
        },
        head: {
          ref: data.head.ref,
          sha: data.head.sha,
        },
        base: {
          ref: data.base.ref,
          sha: data.base.sha,
        },
        labels: data.labels.map((label: any) => ({
          name: typeof label === 'string' ? label : (label.name ?? ''),
          color: typeof label === 'string' ? '' : (label.color ?? ''),
        })),
        draft: data.draft ?? false,
      };

      this.setCached(cacheKey, pr);
      await this.updateRateLimit();
      return pr;
    } catch (error) {
      console.error(`GitHubService: Error fetching PR ${owner}/${repo}#${prNumber}:`, error);
      this.showRateLimitWarning(error);
      return null;
    }
  }

  /**
   * Fetches PR comments (issue comments) from GitHub API.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Array of comments or empty array on error
   */
  async getPRComments(owner: string, repo: string, prNumber: number): Promise<GitHubComment[]> {
    const cacheKey = `comments:${owner}/${repo}#${prNumber}`;
    const cached = this.getCached<GitHubComment[]>(cacheKey, this.config.cacheTTL);
    if (cached !== undefined) {
      return cached;
    }

    try {
      await this.checkRateLimit();

      const { data } = await this.retryWithBackoff(async () => {
        return await this.octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: prNumber,
        });
      });

      const comments: GitHubComment[] = data.map((comment: any) => ({
        id: comment.id,
        body: comment.body ?? '',
        user: {
          login: comment.user?.login ?? 'unknown',
          avatar_url: comment.user?.avatar_url ?? '',
        },
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
      }));

      this.setCached(cacheKey, comments);
      await this.updateRateLimit();
      return comments;
    } catch (error) {
      console.error(
        `GitHubService: Error fetching PR comments ${owner}/${repo}#${prNumber}:`,
        error
      );
      this.showRateLimitWarning(error);
      return [];
    }
  }

  /**
   * Fetches PR reviews from GitHub API.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Array of reviews or empty array on error
   */
  async getPRReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]> {
    const cacheKey = `reviews:${owner}/${repo}#${prNumber}`;
    const cached = this.getCached<GitHubReview[]>(cacheKey, this.config.cacheTTL);
    if (cached !== undefined) {
      return cached;
    }

    try {
      await this.checkRateLimit();

      const { data } = await this.retryWithBackoff(async () => {
        return await this.octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: prNumber,
        });
      });

      const reviews: GitHubReview[] = data.map((review: any) => ({
        id: review.id,
        user: {
          login: review.user?.login ?? 'unknown',
          avatar_url: review.user?.avatar_url ?? '',
        },
        body: review.body,
        state: review.state as GitHubReview['state'],
        submitted_at: review.submitted_at,
        html_url: review.html_url,
      }));

      this.setCached(cacheKey, reviews);
      await this.updateRateLimit();
      return reviews;
    } catch (error) {
      console.error(
        `GitHubService: Error fetching PR reviews ${owner}/${repo}#${prNumber}:`,
        error
      );
      this.showRateLimitWarning(error);
      return [];
    }
  }

  /**
   * Lists pull requests from GitHub API with pagination support.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param state - PR state filter ('open', 'closed', or 'all')
   * @param limit - Maximum number of PRs to fetch (default: 30)
   * @returns Array of PRs or empty array on error
   */
  async listPullRequests(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
    limit: number = 30
  ): Promise<GitHubPR[]> {
    const cacheKey = `list-prs:${owner}/${repo}:${state}:${limit}`;
    const cached = this.getCached<GitHubPR[]>(cacheKey, this.config.cacheTTL);
    if (cached !== undefined) {
      return cached;
    }

    try {
      await this.checkRateLimit();

      // fetch prs with pagination (max 100 per page)
      const perPage = Math.min(limit, 100);
      const { data } = await this.retryWithBackoff(async () => {
        return await this.octokit.rest.pulls.list({
          owner,
          repo,
          state: state,
          per_page: perPage,
          sort: 'updated',
          direction: 'desc',
        });
      });

      // map to our PR format
      const prs: GitHubPR[] = data.slice(0, limit).map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state as 'open' | 'closed',
        html_url: pr.html_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: pr.merged_at,
        user: {
          login: pr.user?.login ?? 'unknown',
          avatar_url: pr.user?.avatar_url ?? '',
        },
        head: {
          ref: pr.head.ref,
          sha: pr.head.sha,
        },
        base: {
          ref: pr.base.ref,
          sha: pr.base.sha,
        },
        labels: pr.labels.map((label: any) => ({
          name: typeof label === 'string' ? label : (label.name ?? ''),
          color: typeof label === 'string' ? '' : (label.color ?? ''),
        })),
        draft: pr.draft ?? false,
      }));

      this.setCached(cacheKey, prs);
      await this.updateRateLimit();
      return prs;
    } catch (error) {
      console.error(`GitHubService: Error listing PRs for ${owner}/${repo}:`, error);
      this.showRateLimitWarning(error);
      return [];
    }
  }

  /**
   * Fetches issue comments from GitHub API.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param issueNumber - Issue number
   * @returns Array of comments or empty array on error
   */
  async getIssueComments(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<GitHubComment[]> {
    // issue comments use same endpoint as PR comments
    return this.getPRComments(owner, repo, issueNumber);
  }

  /**
   * Creates a PR comment (for ballot linking).
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @param body - Comment body (markdown)
   */
  async createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    try {
      await this.checkRateLimit();

      await this.retryWithBackoff(async () => {
        return await this.octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body,
        });
      });

      // invalidate comments cache
      const cacheKey = `comments:${owner}/${repo}#${prNumber}`;
      this.cache.delete(cacheKey);

      await this.updateRateLimit();
      console.log(`GitHubService: Created comment on ${owner}/${repo}#${prNumber}`);
    } catch (error) {
      console.error(
        `GitHubService: Error creating PR comment ${owner}/${repo}#${prNumber}:`,
        error
      );
      this.showRateLimitWarning(error);
      throw error;
    }
  }

  /**
   * Clears the entire cache.
   * Called when reindexing workspace.
   */
  clearCache(): void {
    this.cache.clear();
    console.log('GitHubService: Cache cleared');
  }

  /**
   * Parses a PR reference string (owner/repo#number) into components.
   *
   * @param prRef - PR reference string (e.g., "facebook/react#12345")
   * @returns Parsed reference or null if invalid format
   */
  parsePRReference(prRef: string): PRReference | null {
    const match = prRef.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  }

  /**
   * Formats a PR reference from components.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param number - PR number
   * @returns Formatted PR reference (owner/repo#number)
   */
  formatPRReference(owner: string, repo: string, number: number): string {
    return `${owner}/${repo}#${number}`;
  }

  // private helper methods

  /**
   * Gets cached data if it exists and is not expired.
   */
  private getCached<T>(key: string, ttl: number): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (now - entry.timestamp > ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data as T;
  }

  /**
   * Sets cache entry with current timestamp.
   */
  private setCached<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Retrieves git remote URL from workspace.
   */
  private async getGitRemoteUrl(workspacePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const gitProcess = spawn('git', ['config', '--get', 'remote.origin.url'], {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let resolved = false;

      // timeout after 5 seconds to prevent hangs
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          gitProcess.kill();
          resolve(null);
        }
      }, 5000);

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          if (code !== 0) {
            resolve(null);
            return;
          }

          resolve(stdout.trim());
        }
      });

      gitProcess.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });
  }

  /**
   * Parses GitHub owner/repo from git remote URL.
   * Supports HTTPS and SSH formats.
   */
  private parseGitHubUrl(url: string): GitHubRepo | null {
    // https://github.com/owner/repo.git
    const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/.]+)/);
    if (httpsMatch) {
      return {
        owner: httpsMatch[1],
        repo: httpsMatch[2],
      };
    }

    // git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
    if (sshMatch) {
      return {
        owner: sshMatch[1],
        repo: sshMatch[2],
      };
    }

    return null;
  }

  /**
   * Checks rate limit and warns if approaching limit.
   */
  private async checkRateLimit(): Promise<void> {
    if (!this.rateLimitInfo) {
      return;
    }

    if (this.rateLimitInfo.remaining < 10) {
      const resetDate = new Date(this.rateLimitInfo.reset * 1000);
      vscode.window.showWarningMessage(
        `GitHub API Rate Limit Low: ${this.rateLimitInfo.remaining} requests remaining. Resets at ${resetDate.toLocaleTimeString()}`
      );
    }
  }

  /**
   * Updates rate limit info from API response headers.
   */
  private async updateRateLimit(): Promise<void> {
    try {
      const { data } = await this.octokit.rest.rateLimit.get();
      this.rateLimitInfo = {
        limit: data.rate.limit,
        remaining: data.rate.remaining,
        reset: data.rate.reset,
        used: data.rate.used,
      };
    } catch (error) {
      // rate limit check failed, continue without updating
      console.warn('GitHubService: Failed to update rate limit info:', error);
    }
  }

  /**
   * Retries an async operation with exponential backoff.
   */
  private async retryWithBackoff<T>(operation: () => Promise<T>, attempt: number = 0): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      if (attempt >= this.config.maxRetries) {
        throw error;
      }

      // only retry on rate limit or network errors
      if (error?.status === 403 || error?.status === 429 || error?.code === 'ECONNRESET') {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt);
        console.log(
          `GitHubService: Retrying in ${delay}ms (attempt ${attempt + 1}/${this.config.maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.retryWithBackoff(operation, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Shows user-friendly warning for rate limit errors.
   */
  private showRateLimitWarning(error: any): void {
    if (error?.status === 403 && error?.message?.includes('rate limit')) {
      vscode.window
        .showWarningMessage(
          'GitHub API Rate Limit Exceeded. Configure a GitHub token for higher limits.',
          'Configure Token'
        )
        .then((selection) => {
          if (selection === 'Configure Token') {
            vscode.commands.executeCommand('chorus.configureGitHubToken');
          }
        });
    }
  }
}
