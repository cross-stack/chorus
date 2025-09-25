import * as vscode from 'vscode';
import { LocalDB } from '../storage/LocalDB';

export class ChorusPanel {
	public static currentPanel: ChorusPanel | undefined;
	public static readonly viewType = 'chorus.panel';

	private readonly panel: vscode.WebviewPanel;
	private disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri, db: LocalDB): void {
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
					vscode.Uri.joinPath(extensionUri, 'out', 'panel')
				]
			}
		);

		ChorusPanel.currentPanel = new ChorusPanel(panel, extensionUri, db);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private readonly db: LocalDB
	) {
		this.panel = panel;

		this.update();

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		this.panel.webview.onDidReceiveMessage(
			async (message) => {
				switch (message.command) {
					case 'searchContext':
						await this.handleSearchContext(message.query);
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
				results: results
			});
		} catch (error) {
			console.error('Search failed:', error);
			await this.panel.webview.postMessage({
				command: 'error',
				message: 'Search failed: ' + error
			});
		}
	}

	private async handleSubmitBallot(ballot: any): Promise<void> {
		try {
			await this.db.addBallot({
				pr_reference: ballot.prReference,
				decision: ballot.decision,
				confidence: ballot.confidence,
				rationale: ballot.rationale,
				author_metadata: JSON.stringify({
					name: 'Anonymous', // TODO: Get from git config
					timestamp: new Date().toISOString()
				}),
				revealed: false
			});

			await this.panel.webview.postMessage({
				command: 'ballotSubmitted',
				success: true
			});
		} catch (error) {
			console.error('Ballot submission failed:', error);
			await this.panel.webview.postMessage({
				command: 'error',
				message: 'Ballot submission failed: ' + error
			});
		}
	}

	private async handleRevealBallots(prReference: string): Promise<void> {
		try {
			await this.db.revealBallots(prReference);
			const ballots = await this.db.getBallotsByPR(prReference);
			
			await this.panel.webview.postMessage({
				command: 'ballotsRevealed',
				ballots: ballots
			});
		} catch (error) {
			console.error('Ballot reveal failed:', error);
			await this.panel.webview.postMessage({
				command: 'error',
				message: 'Ballot reveal failed: ' + error
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
				<form id="ballot-form" class="ballot-form">
					<div class="form-group">
						<label for="pr-reference">PR Reference:</label>
						<input type="text" id="pr-reference" required placeholder="e.g., #123 or PR URL">
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
						<input type="range" id="confidence" min="1" max="5" value="3">
						<span id="confidence-value">3</span>
					</div>
					<div class="form-group">
						<label for="rationale">Rationale:</label>
						<textarea id="rationale" required placeholder="Brief explanation of your decision"></textarea>
					</div>
					<button type="submit">Submit Quiet Ballot</button>
				</form>
				<div id="ballot-status" class="status-section"></div>
			</div>
		</div>
	</div>

	<script src="${scriptUri}"></script>
</body>
</html>`;
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
