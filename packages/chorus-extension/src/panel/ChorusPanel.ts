import * as vscode from 'vscode';
import * as path from 'path';
import { LocalDB } from '../storage/LocalDB';
import { Indexer } from '../services/Indexer';
import { Evidence } from '../services/Evidence';
import { Ballots } from '../services/Ballots';
import { Search } from '../services/Search';
import { PanelState, ContextItem, EvidenceItem, QuietBallot } from '../types';

export interface PanelServices {
  db: LocalDB;
  indexer: Indexer;
  evidence: Evidence;
  ballots: Ballots;
  search: Search;
}

export class ChorusPanel {
  public static readonly viewType = 'chorusPanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private currentState: PanelState;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly services: PanelServices,
    initialTab: 'context' | 'evidence' | 'equity' = 'context'
  ) {
    this.extensionUri = context.extensionUri;

    // Create panel
    this.panel = vscode.window.createWebviewPanel(
      ChorusPanel.viewType,
      'Chorus',
      vscode.ViewColumn.Two,
      this.getWebviewOptions()
    );

    // Initialize state
    this.currentState = {
      activeTab: initialTab,
      contextItems: [],
      evidenceItems: [],
    };

    // Set initial HTML content
    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message),
      null,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Load initial data
    this.loadInitialData();
  }

  private getWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out'),
        vscode.Uri.joinPath(this.extensionUri, 'src', 'panel'),
      ],
    };
  }

  private getWebviewContent(): string {
    // Read HTML template
    const htmlPath = path.join(__dirname, '..', 'panel', 'webview.html');

    // For now, return inline HTML (in production, would read from file)
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chorus - Evidence-First Code Review</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 16px;
        }

        .tab-header {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 16px;
        }

        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            font-size: 14px;
            border-bottom: 2px solid transparent;
        }

        .tab:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .tab.active {
            border-bottom-color: var(--vscode-focusBorder);
            color: var(--vscode-focusBorder);
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .context-item, .evidence-item {
            margin-bottom: 12px;
            padding: 12px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }

        .context-item:hover, .evidence-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .context-item-title, .evidence-item-title {
            font-weight: 600;
            margin-bottom: 4px;
            color: var(--vscode-editor-foreground);
        }

        .context-item-meta {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }

        .context-item-content {
            font-size: 13px;
            line-height: 1.4;
            max-height: 100px;
            overflow: hidden;
        }

        .badge {
            display: inline-block;
            padding: 2px 6px;
            font-size: 11px;
            border-radius: 3px;
            margin-right: 6px;
        }

        .badge-commit { background-color: var(--vscode-gitDecoration-modifiedResourceForeground); }
        .badge-doc { background-color: var(--vscode-charts-blue); }
        .badge-pr { background-color: var(--vscode-charts-green); }
        .badge-issue { background-color: var(--vscode-charts-red); }

        .search-box {
            width: 100%;
            padding: 8px 12px;
            margin-bottom: 16px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }

        .btn {
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 8px;
            margin-bottom: 8px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .ballot-form {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 16px;
            margin-bottom: 16px;
        }

        .form-group {
            margin-bottom: 12px;
        }

        .form-label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
        }

        .form-select, .form-textarea {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
        }

        .form-textarea {
            min-height: 80px;
            resize: vertical;
        }

        .empty-state {
            text-align: center;
            padding: 32px;
            color: var(--vscode-descriptionForeground);
        }

        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }

        .status-hidden {
            background-color: var(--vscode-statusBar-noFolderBackground);
            color: var(--vscode-statusBar-noFolderForeground);
        }

        .status-revealed {
            background-color: var(--vscode-statusBar-debuggingBackground);
            color: var(--vscode-statusBar-debuggingForeground);
        }

        .keyboard-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 16px;
        }
    </style>
</head>
<body>
    <div class="tab-header" role="tablist">
        <button class="tab active" data-tab="context" role="tab" aria-selected="true">
            Context
        </button>
        <button class="tab" data-tab="evidence" role="tab" aria-selected="false">
            Evidence
        </button>
        <button class="tab" data-tab="equity" role="tab" aria-selected="false">
            Equity
        </button>
    </div>

    <div id="context-tab" class="tab-content active" role="tabpanel">
        <input type="text" id="context-search" class="search-box" placeholder="Search context..." />
        <div class="btn-group">
            <button class="btn btn-secondary" onclick="refreshContext()">Refresh Index</button>
        </div>
        <div id="context-list"></div>
    </div>

    <div id="evidence-tab" class="tab-content" role="tabpanel">
        <div class="btn-group">
            <button class="btn" onclick="generateEvidenceBlock()">Generate Evidence Block</button>
            <button class="btn btn-secondary" onclick="extractTestEvidence()">Extract Test Evidence</button>
        </div>
        <div id="evidence-list"></div>
    </div>

    <div id="equity-tab" class="tab-content" role="tabpanel">
        <div id="ballot-section"></div>
        <div class="keyboard-hint">
            Press Tab to navigate between form elements. Use Enter to submit forms.
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentState = { activeTab: 'context', contextItems: [], evidenceItems: [] };

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                switchTab(tabName);
                vscode.postMessage({ type: 'switchTab', tab: tabName });
            });
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key >= '1' && e.key <= '3') {
                const tabs = ['context', 'evidence', 'equity'];
                const tabIndex = parseInt(e.key) - 1;
                if (tabIndex < tabs.length) {
                    switchTab(tabs[tabIndex]);
                    e.preventDefault();
                }
            }
        });

        function switchTab(tabName) {
            // Update tab buttons
            document.querySelectorAll('.tab').forEach(tab => {
                const isActive = tab.dataset.tab === tabName;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', isActive.toString());
            });

            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === tabName + '-tab');
            });

            currentState.activeTab = tabName;
        }

        // Context search
        document.getElementById('context-search').addEventListener('input', (e) => {
            const query = e.target.value;
            vscode.postMessage({ type: 'searchContext', query });
        });

        function refreshContext() {
            vscode.postMessage({ type: 'refreshContext' });
        }

        function generateEvidenceBlock() {
            vscode.postMessage({ type: 'generateEvidenceBlock' });
        }

        function extractTestEvidence() {
            vscode.postMessage({ type: 'extractTestEvidence' });
        }

        function submitBallot() {
            const form = document.getElementById('ballot-form');
            if (!form) return;

            const formData = new FormData(form);
            const ballot = {
                decision: formData.get('decision'),
                confidence: parseInt(formData.get('confidence')),
                rationale: formData.get('rationale')
            };

            vscode.postMessage({ type: 'submitBallot', ballot });
        }

        function revealBallot() {
            vscode.postMessage({ type: 'revealBallot' });
        }

        function clearBallot() {
            vscode.postMessage({ type: 'clearBallot' });
        }

        // Message handler
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'updateState':
                    currentState = message.state;
                    renderCurrentState();
                    break;
                case 'switchTab':
                    switchTab(message.tab);
                    break;
            }
        });

        function renderCurrentState() {
            renderContextItems();
            renderEvidenceItems();
            renderBallotSection();
        }

        function renderContextItems() {
            const container = document.getElementById('context-list');

            if (currentState.contextItems.length === 0) {
                container.innerHTML = '<div class="empty-state">No context items found. Try refreshing the index.</div>';
                return;
            }

            container.innerHTML = currentState.contextItems.map(item =>
                \`<div class="context-item" onclick="openContextItem('\${item.id}')">
                    <div class="context-item-title">
                        <span class="badge badge-\${item.type}">\${item.type}</span>
                        \${item.title}
                    </div>
                    <div class="context-item-meta">
                        \${item.author ? 'by ' + item.author + ' " ' : ''}\${new Date(item.timestamp).toLocaleDateString()}
                        " Score: \${item.score.toFixed(1)}
                    </div>
                    <div class="context-item-content">\${item.content.slice(0, 200)}...</div>
                </div>\`
            ).join('');
        }

        function renderEvidenceItems() {
            const container = document.getElementById('evidence-list');

            if (currentState.evidenceItems.length === 0) {
                container.innerHTML = '<div class="empty-state">No evidence items found. Generate an evidence block to get started.</div>';
                return;
            }

            container.innerHTML = currentState.evidenceItems.map(item =>
                \`<div class="evidence-item">
                    <div class="evidence-item-title">
                        <span class="badge badge-\${item.type}">\${item.type}</span>
                        \${item.title}
                        <span class="status-indicator status-\${item.status}">\${item.status}</span>
                    </div>
                    <div class="context-item-content">\${item.content.slice(0, 200)}...</div>
                </div>\`
            ).join('');
        }

        function renderBallotSection() {
            const container = document.getElementById('ballot-section');
            const ballot = currentState.ballot;

            if (!ballot) {
                container.innerHTML = \`
                    <div class="ballot-form">
                        <h3>Submit First-Pass Review</h3>
                        <form id="ballot-form">
                            <div class="form-group">
                                <label class="form-label" for="decision">Decision</label>
                                <select name="decision" class="form-select" required>
                                    <option value="">Select your decision...</option>
                                    <option value="approve">Approve</option>
                                    <option value="needs-work">Request Changes</option>
                                    <option value="reject">Reject</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="confidence">Confidence Level</label>
                                <select name="confidence" class="form-select" required>
                                    <option value="">How confident are you?</option>
                                    <option value="1">1 - Very Low</option>
                                    <option value="2">2 - Low</option>
                                    <option value="3">3 - Medium</option>
                                    <option value="4">4 - High</option>
                                    <option value="5">5 - Very High</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="rationale">Rationale</label>
                                <textarea name="rationale" class="form-textarea"
                                    placeholder="Explain your decision focusing on objective criteria..." required></textarea>
                            </div>
                            <button type="button" class="btn" onclick="submitBallot()">Submit First-Pass Review</button>
                        </form>
                    </div>\`;
            } else {
                const statusClass = ballot.revealed ? 'status-revealed' : 'status-hidden';
                const statusText = ballot.revealed ? 'Identity Revealed' : 'Identity Hidden';

                container.innerHTML = \`
                    <div class="ballot-form">
                        <h3>Your First-Pass Review</h3>
                        <div class="form-group">
                            <span class="status-indicator \${statusClass}">\${statusText}</span>
                        </div>
                        <div class="form-group">
                            <strong>Decision:</strong> \${ballot.decision}<br>
                            <strong>Confidence:</strong> \${ballot.confidence}/5<br>
                            <strong>Submitted:</strong> \${new Date(ballot.timestamp).toLocaleString()}
                        </div>
                        <div class="form-group">
                            <strong>Rationale:</strong><br>
                            \${ballot.rationale}
                        </div>
                        <div class="btn-group">
                            \${!ballot.revealed ? '<button class="btn" onclick="revealBallot()">Reveal Identity</button>' : ''}
                            <button class="btn btn-secondary" onclick="clearBallot()">Clear Ballot</button>
                        </div>
                    </div>\`;
            }
        }

        function openContextItem(itemId) {
            vscode.postMessage({ type: 'openContextItem', itemId });
        }

        // Initial render
        renderCurrentState();
    </script>
</body>
</html>`;
  }

  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'switchTab':
        this.currentState.activeTab = message.tab;
        break;

      case 'searchContext':
        await this.handleSearchContext(message.query);
        break;

      case 'refreshContext':
        await this.handleRefreshContext();
        break;

      case 'generateEvidenceBlock':
        await this.handleGenerateEvidenceBlock();
        break;

      case 'extractTestEvidence':
        await this.handleExtractTestEvidence();
        break;

      case 'submitBallot':
        await this.handleSubmitBallot(message.ballot);
        break;

      case 'revealBallot':
        await this.handleRevealBallot();
        break;

      case 'clearBallot':
        await this.handleClearBallot();
        break;

      case 'openContextItem':
        await this.handleOpenContextItem(message.itemId);
        break;
    }

    // Update webview with current state
    this.updateWebview();
  }

  private async handleSearchContext(query: string): Promise<void> {
    if (!query.trim()) {
      this.currentState.contextItems = this.services.db.getContextItems(20);
      return;
    }

    this.currentState.contextItems = this.services.search.quickSearch(query, 20);
  }

  private async handleRefreshContext(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    try {
      await this.services.indexer.indexGitHistory(workspaceFolder.uri.fsPath, 50);
      await this.services.indexer.indexDocumentation(workspaceFolder.uri.fsPath);
      this.currentState.contextItems = this.services.db.getContextItems(20);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to refresh context: ${error}`);
    }
  }

  private async handleGenerateEvidenceBlock(): Promise<void> {
    const evidenceBlock = this.services.evidence.generateEvidenceBlock();
    await vscode.env.clipboard.writeText(evidenceBlock);
    vscode.window.showInformationMessage('Evidence block copied to clipboard');
  }

  private async handleExtractTestEvidence(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    try {
      await this.services.evidence.extractTestEvidence(workspaceFolder.uri.fsPath);
      this.currentState.evidenceItems = this.services.evidence.getAllEvidence();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to extract test evidence: ${error}`);
    }
  }

  private async handleSubmitBallot(ballot: any): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const prId = path.basename(workspaceFolder.uri.fsPath);
    const result = this.services.ballots.createQuietBallot(
      prId,
      ballot.decision,
      ballot.confidence,
      ballot.rationale
    );

    if (result.success) {
      this.currentState.ballot = result.ballot;
      vscode.window.showInformationMessage(result.message);
    } else {
      vscode.window.showErrorMessage(result.message);
    }
  }

  private async handleRevealBallot(): Promise<void> {
    const currentBallot = this.services.ballots.getCurrentBallot();
    if (!currentBallot) {
      return;
    }

    const result = this.services.ballots.revealBallot(currentBallot.id);
    if (result.success) {
      this.currentState.ballot = result.ballot;
    }
  }

  private async handleClearBallot(): Promise<void> {
    this.services.ballots.clearCurrentBallot();
    this.currentState.ballot = undefined;
  }

  private async handleOpenContextItem(itemId: string): Promise<void> {
    // For now, just show the item in a message
    const item = this.currentState.contextItems.find(item => item.id === itemId);
    if (item) {
      vscode.window.showInformationMessage(`${item.title}: ${item.content.slice(0, 100)}...`);
    }
  }

  private updateWebview(): void {
    this.panel.webview.postMessage({
      type: 'updateState',
      state: this.currentState,
    });
  }

  private async loadInitialData(): Promise<void> {
    // Load context items
    this.currentState.contextItems = this.services.db.getContextItems(20);

    // Load evidence items
    this.currentState.evidenceItems = this.services.evidence.getAllEvidence();

    // Load current ballot
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const prId = path.basename(workspaceFolder.uri.fsPath);
      this.currentState.ballot = this.services.ballots.getBallot(prId);
    }

    this.updateWebview();
  }

  public setActiveTab(tab: 'context' | 'evidence' | 'equity'): void {
    this.currentState.activeTab = tab;
    this.panel.webview.postMessage({
      type: 'switchTab',
      tab,
    });
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.panel.onDidDispose(listener);
  }

  public dispose(): void {
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}