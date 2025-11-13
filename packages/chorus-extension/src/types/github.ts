/**
 * TypeScript types for GitHub API data structures.
 *
 * These types provide comprehensive type safety for GitHub integration,
 * supporting both authenticated and unauthenticated API access with
 * proper discriminated unions for different PR states.
 */

/**
 * GitHub repository information parsed from git remote.
 */
export interface GitHubRepo {
  owner: string;
  repo: string;
}

/**
 * Parsed GitHub pull request data.
 */
export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  user: {
    login: string;
    avatar_url: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  labels: Array<{
    name: string;
    color: string;
  }>;
  draft: boolean;
}

/**
 * GitHub issue/PR comment data.
 */
export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
  html_url: string;
}

/**
 * GitHub PR review data.
 */
export interface GitHubReview {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submitted_at: string | null;
  html_url: string;
}

/**
 * Cache entry with timestamp for TTL management.
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * GitHub API rate limit information.
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // unix timestamp
  used: number;
}

/**
 * GitHub API error response.
 */
export interface GitHubError {
  message: string;
  documentation_url?: string;
  status?: number;
}

/**
 * Configuration for GitHub service.
 */
export interface GitHubServiceConfig {
  token?: string | undefined;
  cacheTTL?: number; // milliseconds, default 5 minutes
  staticCacheTTL?: number; // milliseconds, default 1 hour
  maxRetries?: number; // default 3
  retryDelayMs?: number; // default 1000
}

/**
 * Result type for GitHub operations with error handling.
 */
export type GitHubResult<T> = { success: true; data: T } | { success: false; error: GitHubError };

/**
 * PR reference format used in Chorus (owner/repo#number).
 */
export interface PRReference {
  owner: string;
  repo: string;
  number: number;
}
