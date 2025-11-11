import * as vscode from 'vscode';
import { LocalDB, BallotEntry } from '../storage/LocalDB';
import { getGitUserInfo } from '../services/GitConfigService';
import { GitHubService } from '../services/GitHubService';

export class ChorusPanel {
  public static currentPanel: ChorusPanel | undefined;
  public static readonly viewType = 'chorus.panel';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private readonly githubService: GitHubService | undefined;

  public static createOrShow(
    extensionUri: vscode.Uri,
    db: LocalDB,
    githubService?: GitHubService
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ChorusPanel.currentPanel) {
      ChorusPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ChorusPanel.viewType,
      'Chorus',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'out', 'panel'),
        ],
      }
    );

    ChorusPanel.currentPanel = new ChorusPanel(panel, extensionUri, db, githubService);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly db: LocalDB,
    githubService?: GitHubService
  ) {
    this.panel = panel;
    this.githubService = githubService;

    this.update();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'searchContext':
            await this.handleSearchContext(message.query);
            return;
          case 'getPRPhase':
            await this.handleGetPRPhase(message.prReference);
            return;
          case 'startBlindedReview':
            await this.handleStartBlindedReview(message);
            return;
          case 'submitBallot':
            await this.handleSubmitBallot(message.ballot);
            return;
          case 'revealBallots':
            await this.handleRevealBallots(message.prReference);
            return;
        }
      },
      null,
      this.disposables
    );
  }

  private async handleSearchContext(query: string): Promise<void> {
    try {
      const results = await this.db.searchContext(query);
      await this.panel.webview.postMessage({
        command: 'searchResults',
        results: results,
      });
    } catch (error) {
      console.error('Search failed:', error);
      await this.panel.webview.postMessage({
        command: 'error',
        message: 'Search failed: ' + error,
      });
    }
  }

  private async handleGetPRPhase(prReference: string): Promise<void> {
    try {
      // fetch current phase for ui rendering
      const phase = await this.db.getPRPhase(prReference);
      const ballots = await this.db.getBallotsByPR(prReference);
      const canReveal = await this.db.canRevealBallots(prReference);
      const canSubmit = await this.db.canSubmitBallot(prReference);

      await this.panel.webview.postMessage({
        command: 'prPhaseUpdate',
        phaseData: {
          phase: phase,
          ballotCount: ballots.length,
          canReveal: canReveal,
          canSubmit: canSubmit,
        },
      });
    } catch (error) {
      console.error('Failed to Get PR Phase:', error);
      await this.panel.webview.postMessage({
        command: 'error',
        message: 'Failed to Get PR Phase: ' + error,
      });
    }
  }

  private async handleStartBlindedReview(message: any): Promise<void> {
    try {
      const prReference = message.prReference;
      const threshold = message.threshold || 3;

      // validate pr reference
      if (!prReference || !prReference.trim()) {
        await this.panel.webview.postMessage({
          command: 'error',
          message: 'Invalid PR Reference',
        });
        return;
      }

      // check if pr already has ballots submitted
      const existingBallots = await this.db.getBallotsByPR(prReference);

      if (existingBallots.length > 0) {
        await this.panel.webview.postMessage({
          command: 'error',
          message: 'PR Already Exists - Ballots Have Been Submitted',
        });
        return;
      }

      // initialize pr in blinded phase with threshold
      await this.db.startBlindedReview(prReference, threshold);

      await this.panel.webview.postMessage({
        command: 'blindedReviewStarted',
        success: true,
        prReference: prReference,
        threshold: threshold,
      });
    } catch (error) {
      console.error('Failed to Start Blinded Review:', error);
      await this.panel.webview.postMessage({
        command: 'error',
        message: 'Failed to Start Blinded Review: ' + error,
      });
    }
  }

  private async handleSubmitBallot(ballot: any): Promise<void> {
    try {
      // check if PR is in blinded phase
      // ballots can only be submitted during blinded phase
      const canSubmit = await this.db.canSubmitBallot(ballot.prReference);
      if (!canSubmit) {
        await this.panel.webview.postMessage({
          command: 'error',
          message: 'Ballots cannot be submitted after the reveal phase has begun',
        });
        return;
      }

      // get git user info from workspace
      // privacy-preserving: only stored, not immediately displayed
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const workspacePath = workspaceFolders?.[0]?.uri.fsPath || '';

      const userInfo = await getGitUserInfo(workspacePath);
      const authorMetadata = {
        name: userInfo?.name || 'Anonymous',
        email: userInfo?.email || '',
        timestamp: new Date().toISOString(),
      };

      await this.db.addBallot({
        pr_reference: ballot.prReference,
        decision: ballot.decision,
        confidence: ballot.confidence,
        rationale: ballot.rationale,
        author_metadata: JSON.stringify(authorMetadata),
        revealed: false,
      });

      await this.panel.webview.postMessage({
        command: 'ballotSubmitted',
        success: true,
      });
    } catch (error) {
      console.error('Ballot submission failed:', error);
      await this.panel.webview.postMessage({
        command: 'error',
        message: 'Ballot submission failed: ' + error,
      });
    }
  }

  private async handleRevealBallots(prReference: string): Promise<void> {
    try {
      // check if ballots can be revealed
      // phase must be blinded and threshold met
      const canReveal = await this.db.canRevealBallots(prReference);

      if (!canReveal) {
        const phase = await this.db.getPRPhase(prReference);
        const ballots = await this.db.getBallotsByPR(prReference);

        // provide specific error message based on reason
        if (phase === 'revealed') {
          await this.panel.webview.postMessage({
            command: 'error',
            message: 'Ballots Have Already Been Revealed',
          });
        } else if (phase === null) {
          await this.panel.webview.postMessage({
            command: 'error',
            message: 'PR Review Not Started - Use "Start Blinded Review" First',
          });
        } else {
          // phase is blinded but threshold not met
          await this.panel.webview.postMessage({
            command: 'error',
            message: `Cannot Reveal Ballots: Minimum Threshold Not Met (${ballots.length} ballot(s) submitted)`,
          });
        }
        return;
      }

      // reveal ballots and transition phase
      await this.db.revealBallots(prReference);
      const ballots = await this.db.getBallotsByPR(prReference);

      await this.panel.webview.postMessage({
        command: 'ballotsRevealed',
        ballots: ballots,
      });

      // attempt to post ballot summary to github (async, non-blocking)
      // this runs in background and doesn't block the reveal workflow
      this.postBallotsToGitHub(prReference, ballots).catch((error) => {
        // errors are already handled in postBallotsToGitHub
        console.error('Background GitHub post failed:', error);
      });
    } catch (error) {
      console.error('Ballot Reveal Failed:', error);
      await this.panel.webview.postMessage({
        command: 'error',
        message: 'Ballot Reveal Failed: ' + error,
      });
    }
  }

  private update(): void {
    this.panel.title = 'Chorus';
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.js')
    );

    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Chorus</title>
</head>
<body>
	<div class="chorus-panel">
		<nav class="tab-nav" role="tablist">
			<button class="tab-button active" data-tab="context" role="tab" aria-selected="true">Context</button>
			<button class="tab-button" data-tab="evidence" role="tab" aria-selected="false">Evidence</button>
			<button class="tab-button" data-tab="equity" role="tab" aria-selected="false">Equity</button>
		</nav>

		<div class="tab-content">
			<div id="context-tab" class="tab-pane active" role="tabpanel">
				<div class="search-section">
					<input type="text" id="context-search" placeholder="Search context..." aria-label="Search context">
					<button id="search-button">Search</button>
				</div>
				<div id="context-results" class="results-section"></div>
			</div>

			<div id="evidence-tab" class="tab-pane" role="tabpanel">
				<form id="evidence-form" class="evidence-form">
					<div class="form-group">
						<label for="tests-field">Tests (required):</label>
						<textarea id="tests-field" required placeholder="Link to test files or describe test coverage"></textarea>
					</div>
					<div class="form-group">
						<label for="benchmarks-field">Benchmarks:</label>
						<textarea id="benchmarks-field" placeholder="Performance metrics or N/A"></textarea>
					</div>
					<div class="form-group">
						<label for="spec-field">Spec/ADR:</label>
						<textarea id="spec-field" placeholder="Link to specification or architectural decision record"></textarea>
					</div>
					<div class="form-group">
						<label for="risk-field">Risk Notes (required):</label>
						<textarea id="risk-field" required placeholder="Security, breaking changes, or other risks"></textarea>
					</div>
					<button type="submit">Generate Evidence Block</button>
				</form>
			</div>

			<div id="equity-tab" class="tab-pane" role="tabpanel">
				<!-- Phase indicator section -->
				<div id="phase-section" class="phase-section">
					<p class="equity-help-text">Enter a PR Reference Below to Begin</p>
				</div>

				<!-- Start review button -->
				<button id="start-review-button" class="primary-button" style="display: none;">Start Blinded Review</button>

				<!-- Ballot submission form -->
				<form id="ballot-form" class="ballot-form">
					<div class="form-group">
						<label for="pr-reference">PR Reference:</label>
						<input type="text" id="pr-reference" required placeholder="e.g., #123 or PR URL" aria-describedby="pr-help">
						<small id="pr-help" class="equity-help-text">Enter PR number or URL to check review status</small>
					</div>
					<div class="form-group">
						<label for="decision">Decision:</label>
						<select id="decision" required>
							<option value="">Select decision</option>
							<option value="approve">Approve</option>
							<option value="neutral">Neutral</option>
							<option value="reject">Reject</option>
						</select>
					</div>
					<div class="form-group">
						<label for="confidence">Confidence (1-5):</label>
						<input type="range" id="confidence" min="1" max="5" value="3" aria-valuemin="1" aria-valuemax="5" aria-valuenow="3">
						<span id="confidence-value" aria-live="polite">3</span>
					</div>
					<div class="form-group">
						<label for="rationale">Rationale:</label>
						<textarea id="rationale" required placeholder="Brief explanation of your decision" aria-describedby="rationale-help"></textarea>
						<small id="rationale-help" class="equity-help-text">Provide reasoning for your decision</small>
					</div>
					<button type="submit">Submit Quiet Ballot</button>
				</form>

				<!-- Reveal button -->
				<button id="reveal-button" class="reveal-button" disabled aria-label="Reveal Ballots">Reveal Results</button>

				<!-- Status section for ballot display -->
				<div id="ballot-status" class="status-section"></div>
			</div>

		</div>
	</div>

	<script src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Formats a ballot summary comment for GitHub PR posting.
   *
   * Generates a markdown-formatted summary of ballot results including:
   * - Review phase completion timestamp
   * - Total ballot count
   * - Decision distribution (approve/neutral/reject)
   * - Confidence level distribution
   * - Average confidence score
   * - Chorus branding footer
   *
   * @param ballots - Array of ballot entries to summarize
   * @returns Formatted markdown string for GitHub comment
   */
  private formatBallotSummary(ballots: BallotEntry[]): string {
    const timestamp = new Date().toISOString();
    const totalCount = ballots.length;

    // calculate decision distribution
    const approveCount = ballots.filter((b) => b.decision === 'approve').length;
    const neutralCount = ballots.filter((b) => b.decision === 'neutral').length;
    const rejectCount = ballots.filter((b) => b.decision === 'reject').length;

    // calculate percentages
    const approvePercent = totalCount > 0 ? Math.round((approveCount / totalCount) * 100) : 0;
    const neutralPercent = totalCount > 0 ? Math.round((neutralCount / totalCount) * 100) : 0;
    const rejectPercent = totalCount > 0 ? Math.round((rejectCount / totalCount) * 100) : 0;

    // calculate confidence distribution
    const highConfidence = ballots.filter((b) => b.confidence >= 4).length;
    const mediumConfidence = ballots.filter((b) => b.confidence === 3).length;
    const lowConfidence = ballots.filter((b) => b.confidence <= 2).length;

    // calculate average confidence
    const avgConfidence =
      totalCount > 0
        ? (ballots.reduce((sum, b) => sum + b.confidence, 0) / totalCount).toFixed(1)
        : '0.0';

    return `## 🎭 Chorus Evidence - Blinded Review Results

**Review Phase Completed**: ${timestamp}
**Ballots Submitted**: ${totalCount}

### Review Summary
- ✅ Approve: ${approveCount} (${approvePercent}%)
- ⏸️ Neutral: ${neutralCount} (${neutralPercent}%)
- ❌ Reject: ${rejectCount} (${rejectPercent}%)

### Confidence Distribution
- High (4-5): ${highConfidence}
- Medium (3): ${mediumConfidence}
- Low (1-2): ${lowConfidence}

**Average Confidence**: ${avgConfidence}/5

---
*Posted by [Chorus Evidence](https://github.com/cross-stack/chorus) - Evidence-first, bias-aware code review*`;
  }

  /**
   * Posts ballot summary to GitHub PR as a comment.
   *
   * Implements privacy-first GitHub integration with:
   * - User permission prompt before posting
   * - Auto-post setting respect
   * - Duplicate post prevention
   * - PR reference parsing and validation
   * - Error handling with user-friendly messages
   *
   * Workflow:
   * 1. Check if already posted (prevent duplicates)
   * 2. Parse PR reference to extract owner/repo/number
   * 3. Detect GitHub repo from workspace (for short refs like #123)
   * 4. Ask user permission (unless auto-post enabled)
   * 5. Format ballot summary comment
   * 6. Post comment via GitHubService
   * 7. Store comment URL in database
   * 8. Show success notification
   *
   * @param prReference - PR reference string (e.g., "owner/repo#123" or "#123")
   * @param ballots - Array of ballot entries to summarize
   * @returns Promise that resolves when posting completes or is cancelled
   */
  private async postBallotsToGitHub(prReference: string, ballots: BallotEntry[]): Promise<void> {
    // check if github service is available
    if (!this.githubService) {
      console.log('ChorusPanel: GitHubService not available, skipping ballot post');
      return;
    }

    try {
      // check if already posted to prevent duplicates
      const alreadyPosted = await this.db.isPostedToGitHub(prReference);
      if (alreadyPosted) {
        console.log(`ChorusPanel: Ballots already posted to GitHub for ${prReference}`);
        return;
      }

      // parse pr reference
      let owner: string;
      let repo: string;
      let prNumber: number;

      // check if it's a short reference like #123
      if (prReference.match(/^#(\d+)$/)) {
        const match = prReference.match(/^#(\d+)$/);
        if (!match) {
          console.error('ChorusPanel: Invalid PR reference format');
          return;
        }

        prNumber = parseInt(match[1], 10);

        // detect github repo from workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          console.error('ChorusPanel: No workspace folder found for repo detection');
          return;
        }

        const githubRepo = await this.githubService.detectGitHubRepo(
          workspaceFolders[0].uri.fsPath
        );
        if (!githubRepo) {
          console.error('ChorusPanel: Could not detect GitHub repository');
          vscode.window.showWarningMessage(
            'Could Not Detect GitHub Repository - Ballots Not Posted'
          );
          return;
        }

        owner = githubRepo.owner;
        repo = githubRepo.repo;
      } else {
        // parse full reference like owner/repo#123
        const parsed = this.githubService.parsePRReference(prReference);
        if (!parsed) {
          console.error(`ChorusPanel: Invalid PR reference format: ${prReference}`);
          return;
        }

        owner = parsed.owner;
        repo = parsed.repo;
        prNumber = parsed.number;
      }

      // check auto-post setting
      const config = vscode.workspace.getConfiguration('chorus');
      const autoPost = config.get<boolean>('autoPostBallots', false);

      // ask user permission unless auto-post is enabled
      if (!autoPost) {
        const selection = await vscode.window.showInformationMessage(
          `Post Ballot Summary to GitHub PR #${prNumber}?`,
          { modal: true },
          'Post',
          'Cancel'
        );

        if (selection !== 'Post') {
          console.log('ChorusPanel: User cancelled ballot posting');
          return;
        }
      }

      // format ballot summary
      const commentBody = this.formatBallotSummary(ballots);

      // post comment to github
      await this.githubService.createPRComment(owner, repo, prNumber, commentBody);

      // construct comment url
      const commentUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

      // mark as posted in database
      await this.db.markBallotsPostedToGitHub(prReference, commentUrl);

      // show success notification
      vscode.window.showInformationMessage(
        `Ballot Summary Posted to GitHub PR #${prNumber}`,
        'View PR'
      ).then((selection) => {
        if (selection === 'View PR') {
          vscode.env.openExternal(vscode.Uri.parse(commentUrl));
        }
      });

      console.log(`ChorusPanel: Ballot summary posted to ${commentUrl}`);
    } catch (error) {
      console.error('ChorusPanel: Failed to post ballots to GitHub:', error);
      vscode.window.showErrorMessage(
        `Failed to Post Ballots to GitHub: ${error instanceof Error ? error.message : 'Unknown Error'}`
      );
    }
  }

  public dispose(): void {
    ChorusPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
