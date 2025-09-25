import * as vscode from 'vscode';
import * as path from 'path';
import { LocalDB } from './storage/LocalDB';
import { Indexer } from './services/Indexer';
import { Evidence } from './services/Evidence';
import { Ballots } from './services/Ballots';
import { Search } from './services/Search';
import { ChorusPanel } from './panel/ChorusPanel';
import { RelatedContextLens } from './codelens/RelatedContextLens';
import { registerCommands } from './commands';

export class ChorusExtension {
  private db: LocalDB;
  private indexer: Indexer;
  private evidence: Evidence;
  private ballots: Ballots;
  private search: Search;
  private panel?: ChorusPanel;
  private statusBarItem: vscode.StatusBarItem;
  private codeLensProvider: RelatedContextLens;

  constructor(private context: vscode.ExtensionContext) {
    // Initialize database with extension storage path
    this.db = new LocalDB(context.globalStorageUri.fsPath);

    // Initialize services
    this.indexer = new Indexer(this.db);
    this.evidence = new Evidence(this.db);
    this.ballots = new Ballots(this.db);
    this.search = new Search(this.db);

    // Initialize UI components
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.codeLensProvider = new RelatedContextLens(this.indexer);

    this.updateStatusBar();
  }

  async activate(): Promise<void> {
    console.log('Activating Chorus extension...');

    try {
      // Register commands
      registerCommands(this.context, {
        db: this.db,
        indexer: this.indexer,
        evidence: this.evidence,
        ballots: this.ballots,
        search: this.search,
        extension: this,
      });

      // Register CodeLens provider
      this.context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
          { scheme: 'file', language: '*' },
          this.codeLensProvider
        )
      );

      // Show status bar item
      this.statusBarItem.show();
      this.context.subscriptions.push(this.statusBarItem);

      // Index workspace on activation (background task)
      this.indexWorkspaceInBackground();

      // Listen for file changes to update context
      const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);

      fileWatcher.onDidChange(uri => this.onFileChanged(uri));
      fileWatcher.onDidCreate(uri => this.onFileChanged(uri));

      this.context.subscriptions.push(fileWatcher);

      console.log('Chorus extension activated successfully');
    } catch (error) {
      console.error('Failed to activate Chorus extension:', error);
      vscode.window.showErrorMessage(`Chorus activation failed: ${error}`);
    }
  }

  deactivate(): void {
    console.log('Deactivating Chorus extension...');

    try {
      this.db.close();
      this.statusBarItem.dispose();

      if (this.panel) {
        this.panel.dispose();
      }

      console.log('Chorus extension deactivated successfully');
    } catch (error) {
      console.error('Error during Chorus deactivation:', error);
    }
  }

  /**
   * Open the Chorus panel with specified tab
   */
  async openPanel(activeTab?: 'context' | 'evidence' | 'equity'): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      if (activeTab) {
        this.panel.setActiveTab(activeTab);
      }
      return;
    }

    this.panel = new ChorusPanel(
      this.context,
      {
        db: this.db,
        indexer: this.indexer,
        evidence: this.evidence,
        ballots: this.ballots,
        search: this.search,
      },
      activeTab
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.updateStatusBar();
    });

    this.updateStatusBar();
  }

  /**
   * Check if first-pass review is active
   */
  isFirstPassActive(): boolean {
    // Check if there's an active ballot for current workspace
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return false;
    }

    // Use workspace folder name as PR identifier
    const prId = path.basename(workspaceFolder.uri.fsPath);
    return this.ballots.isFirstPassActive(prId);
  }

  /**
   * Update status bar based on current state
   */
  private updateStatusBar(): void {
    const isFirstPassActive = this.isFirstPassActive();
    const isPanelOpen = this.panel !== undefined;

    if (isFirstPassActive) {
      this.statusBarItem.text = '$(eye-closed) Chorus: First-pass active';
      this.statusBarItem.tooltip = 'First-pass review mode is active. Author identities are hidden.';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (isPanelOpen) {
      this.statusBarItem.text = '$(eye) Chorus: Panel open';
      this.statusBarItem.tooltip = 'Chorus panel is open. Click to focus.';
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = '$(search) Chorus';
      this.statusBarItem.tooltip = 'Click to open Chorus panel for context, evidence, and equity features.';
      this.statusBarItem.backgroundColor = undefined;
    }

    this.statusBarItem.command = 'chorus.openPanel';
  }

  /**
   * Background indexing of workspace
   */
  private async indexWorkspaceInBackground(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    try {
      console.log('Starting background indexing...');

      // Index git history
      await this.indexer.indexGitHistory(workspaceFolder.uri.fsPath, 50);

      // Index documentation
      await this.indexer.indexDocumentation(workspaceFolder.uri.fsPath);

      // Extract test evidence
      await this.evidence.extractTestEvidence(workspaceFolder.uri.fsPath);

      console.log('Background indexing completed');
    } catch (error) {
      console.error('Background indexing failed:', error);
    }
  }

  /**
   * Handle file changes for context updates
   */
  private async onFileChanged(uri: vscode.Uri): Promise<void> {
    // Only process files in workspace
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      return;
    }

    try {
      // Re-index if it's a documentation file
      if (uri.fsPath.endsWith('.md')) {
        await this.indexer.indexDocumentation(workspaceFolder.uri.fsPath);
      }

      // Refresh CodeLens if panel is open
      if (this.panel) {
        vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
      }
    } catch (error) {
      console.error('Error handling file change:', error);
    }
  }
}

// Global extension instance
let extension: ChorusExtension;

export function activate(context: vscode.ExtensionContext): Promise<void> {
  extension = new ChorusExtension(context);
  return extension.activate();
}

export function deactivate(): void {
  if (extension) {
    extension.deactivate();
  }
}