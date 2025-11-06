import * as vscode from 'vscode';

export class WelcomePanel {
  public static currentPanel: WelcomePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static show(extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.One;

    // if we already have a panel, show it
    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel._panel.reveal(column);
      return;
    }

    // otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'chorusWelcome',
      'Welcome to Chorus',
      column,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    );

    WelcomePanel.currentPanel = new WelcomePanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
    this._panel = panel;

    // set the webview's initial html content
    this._panel.webview.html = this._getHtmlContent();

    // listen for when the panel is disposed
    // this happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'showSidebar':
            await vscode.commands.executeCommand('chorus.focusContextView');
            break;
          case 'addEvidence':
            await vscode.commands.executeCommand('chorus.addEvidence');
            break;
          case 'submitBallot':
            await vscode.commands.executeCommand('chorus.quickSubmitBallot');
            break;
          case 'dismiss':
            this._panel.dispose();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private _getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Chorus</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      line-height: 1.6;
    }

    h1 {
      color: var(--vscode-textLink-foreground);
      margin-bottom: 10px;
    }

    .hero {
      font-size: 2.5em;
      margin-bottom: 20px;
    }

    .subtitle {
      font-size: 1.2em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 30px;
    }

    .section {
      margin-bottom: 30px;
      padding: 20px;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
    }

    .section h2 {
      margin-top: 0;
      color: var(--vscode-textLink-foreground);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-icon {
      font-size: 1.5em;
    }

    .section p {
      margin-bottom: 10px;
    }

    .section ul {
      margin-top: 10px;
      padding-left: 20px;
    }

    .section li {
      margin-bottom: 5px;
    }

    .button-group {
      display: flex;
      gap: 10px;
      margin-top: 15px;
      flex-wrap: wrap;
    }

    button {
      padding: 10px 20px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    button.secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button.secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--vscode-panel-border);
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .keyboard-shortcut {
      display: inline-block;
      padding: 2px 6px;
      background-color: var(--vscode-keybindingLabel-background);
      color: var(--vscode-keybindingLabel-foreground);
      border: 1px solid var(--vscode-keybindingLabel-border);
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="hero">🎭</div>
  <h1>Welcome to Chorus!</h1>
  <p class="subtitle">Transform code reviews into evidence-based, bias-aware decision spaces.</p>

  <div class="section">
    <h2><span class="section-icon">🔍</span> Discover Context</h2>
    <p>
      Chorus automatically indexes your git history and documentation to surface relevant context
      when you need it. Never miss important background information again.
    </p>
    <ul>
      <li>View related commits and docs in the <strong>Chorus sidebar</strong></li>
      <li>Hover over code to see inline context suggestions</li>
      <li>Click CodeLens annotations to explore relationships</li>
    </ul>
    <div class="button-group">
      <button onclick="showSidebar()">Open Chorus Sidebar</button>
      <span class="keyboard-shortcut">Ctrl+Shift+K</span>
    </div>
  </div>

  <div class="section">
    <h2><span class="section-icon">📊</span> Add Evidence</h2>
    <p>
      Structure your PR feedback around evidence, not opinions. Generate comprehensive
      evidence blocks with test results, benchmarks, and risk assessments.
    </p>
    <ul>
      <li>Copy test output to clipboard</li>
      <li>Run the Add Evidence command</li>
      <li>Chorus auto-formats results into structured markdown</li>
    </ul>
    <div class="button-group">
      <button onclick="addEvidence()">Try Adding Evidence</button>
      <span class="keyboard-shortcut">Ctrl+Shift+E</span>
    </div>
  </div>

  <div class="section">
    <h2><span class="section-icon">🗳️</span> Submit Ballots</h2>
    <p>
      Vote on PRs anonymously during the blinded review phase. Provide evidence-based
      rationale and confidence levels to make your judgment explicit.
    </p>
    <ul>
      <li>Submit ballots before identities are revealed</li>
      <li>Rate your confidence (1-5) in your decision</li>
      <li>Ground rationale in tests, specs, and benchmarks</li>
    </ul>
    <div class="button-group">
      <button onclick="submitBallot()">Submit a Ballot</button>
      <span class="keyboard-shortcut">Ctrl+Shift+B</span>
    </div>
  </div>

  <div class="footer">
    <p>
      <strong>Why Chorus?</strong><br>
      Chorus combats hidden-profile effects, groupthink, and pluralistic ignorance
      by making evidence visible, dissent safe, and decision processes explicit.
    </p>
    <div class="button-group" style="justify-content: center; margin-top: 20px;">
      <button class="secondary" onclick="dismiss()">Dismiss</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function showSidebar() {
      vscode.postMessage({ command: 'showSidebar' });
    }

    function addEvidence() {
      vscode.postMessage({ command: 'addEvidence' });
    }

    function submitBallot() {
      vscode.postMessage({ command: 'submitBallot' });
    }

    function dismiss() {
      vscode.postMessage({ command: 'dismiss' });
    }
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    WelcomePanel.currentPanel = undefined;

    // clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
