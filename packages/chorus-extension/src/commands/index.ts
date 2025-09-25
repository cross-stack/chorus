import * as vscode from 'vscode';
import * as path from 'path';
import { LocalDB } from '../storage/LocalDB';
import { Indexer } from '../services/Indexer';
import { Evidence } from '../services/Evidence';
import { Ballots, BallotSubmissionResult } from '../services/Ballots';
import { Search } from '../services/Search';
import { ChorusExtension } from '../extension';

export interface CommandContext {
  db: LocalDB;
  indexer: Indexer;
  evidence: Evidence;
  ballots: Ballots;
  search: Search;
  extension: ChorusExtension;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  // Register all commands
  const commands = [
    vscode.commands.registerCommand('chorus.openPanel', () => openPanel(commandContext)),
    vscode.commands.registerCommand('chorus.addEvidence', () => addEvidence(commandContext)),
    vscode.commands.registerCommand('chorus.submitFirstPass', () => submitFirstPass(commandContext)),

    // Additional utility commands
    vscode.commands.registerCommand('chorus.openContext', () => openPanel(commandContext, 'context')),
    vscode.commands.registerCommand('chorus.openEvidence', () => openPanel(commandContext, 'evidence')),
    vscode.commands.registerCommand('chorus.openEquity', () => openPanel(commandContext, 'equity')),
    vscode.commands.registerCommand('chorus.refreshIndex', () => refreshIndex(commandContext)),
    vscode.commands.registerCommand('chorus.clearBallot', () => clearBallot(commandContext)),
    vscode.commands.registerCommand('chorus.revealBallot', () => revealBallot(commandContext)),
  ];

  // Add all commands to subscription cleanup
  context.subscriptions.push(...commands);
}

/**
 * Open Chorus panel with optional active tab
 */
async function openPanel(
  { extension }: CommandContext,
  activeTab?: 'context' | 'evidence' | 'equity'
): Promise<void> {
  try {
    await extension.openPanel(activeTab);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Chorus panel: ${error}`);
  }
}

/**
 * Add evidence block to current editor or clipboard
 */
async function addEvidence({ evidence }: CommandContext): Promise<void> {
  try {
    const activeEditor = vscode.window.activeTextEditor;

    if (!activeEditor) {
      // No active editor, copy to clipboard
      const evidenceBlock = evidence.generateEvidenceBlock();
      await vscode.env.clipboard.writeText(evidenceBlock);

      vscode.window.showInformationMessage(
        'Evidence block template copied to clipboard. Paste into your PR description.',
        'Open Panel'
      ).then(selection => {
        if (selection === 'Open Panel') {
          vscode.commands.executeCommand('chorus.openEvidence');
        }
      });
      return;
    }

    // Insert evidence block at cursor position
    const selection = activeEditor.selection;
    const evidenceBlock = evidence.generateEvidenceBlock();

    await activeEditor.edit(editBuilder => {
      editBuilder.insert(selection.start, evidenceBlock);
    });

    vscode.window.showInformationMessage(
      'Evidence block template inserted. Complete the sections as needed.',
      'Open Panel'
    ).then(selection => {
      if (selection === 'Open Panel') {
        vscode.commands.executeCommand('chorus.openEvidence');
      }
    });

    // Auto-detect and create evidence from current file if it's a test file
    await autoDetectTestEvidence(evidence, activeEditor);

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add evidence: ${error}`);
  }
}

/**
 * Submit first-pass review (quiet ballot)
 */
async function submitFirstPass({ ballots, extension }: CommandContext): Promise<void> {
  try {
    // Get workspace identifier for PR
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found for ballot submission.');
      return;
    }

    const prId = path.basename(workspaceFolder.uri.fsPath);

    // Show input forms for ballot submission
    const decision = await vscode.window.showQuickPick(
      [
        { label: 'Approve', description: 'Changes look good and ready to merge', value: 'approve' },
        { label: 'Request Changes', description: 'Issues found that need to be addressed', value: 'needs-work' },
        { label: 'Reject', description: 'Changes are not acceptable', value: 'reject' },
      ],
      {
        title: 'First-Pass Review Decision',
        placeHolder: 'Select your review decision...',
      }
    );

    if (!decision) {
      return; // User cancelled
    }

    const confidenceOptions = [
      { label: '1 - Very Low', description: 'Minimal confidence in assessment', value: 1 },
      { label: '2 - Low', description: 'Limited confidence', value: 2 },
      { label: '3 - Medium', description: 'Moderate confidence', value: 3 },
      { label: '4 - High', description: 'Strong confidence', value: 4 },
      { label: '5 - Very High', description: 'Complete confidence in assessment', value: 5 },
    ];

    const confidenceChoice = await vscode.window.showQuickPick(
      confidenceOptions,
      {
        title: 'Confidence Level',
        placeHolder: 'How confident are you in your assessment?',
      }
    );

    if (!confidenceChoice) {
      return; // User cancelled
    }

    const rationale = await vscode.window.showInputBox({
      title: 'Review Rationale',
      prompt: 'Explain your decision (minimum 10 characters)',
      placeHolder: 'Focus on objective criteria: functionality, code quality, design, testing...',
      validateInput: (value) => {
        if (!value || value.trim().length < 10) {
          return 'Rationale must be at least 10 characters long';
        }
        return undefined;
      }
    });

    if (!rationale) {
      return; // User cancelled
    }

    // Submit the ballot
    const result: BallotSubmissionResult = ballots.createQuietBallot(
      prId,
      decision.value as any,
      confidenceChoice.value as any,
      rationale
    );

    if (result.success) {
      vscode.window.showInformationMessage(
        result.message,
        'Open Panel'
      ).then(selection => {
        if (selection === 'Open Panel') {
          vscode.commands.executeCommand('chorus.openEquity');
        }
      });

      // Update extension state
      await extension.openPanel('equity');
    } else {
      vscode.window.showErrorMessage(result.message);
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to submit first-pass review: ${error}`);
  }
}

/**
 * Refresh context index
 */
async function refreshIndex({ indexer, evidence }: CommandContext): Promise<void> {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found for indexing.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Refreshing Chorus index...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: 'Indexing git history...' });
        await indexer.indexGitHistory(workspaceFolder.uri.fsPath, 100);

        progress.report({ increment: 33, message: 'Indexing documentation...' });
        await indexer.indexDocumentation(workspaceFolder.uri.fsPath);

        progress.report({ increment: 66, message: 'Extracting test evidence...' });
        await evidence.extractTestEvidence(workspaceFolder.uri.fsPath);

        progress.report({ increment: 100, message: 'Index refresh complete' });
      }
    );

    vscode.window.showInformationMessage(
      'Chorus index refreshed successfully.',
      'Open Panel'
    ).then(selection => {
      if (selection === 'Open Panel') {
        vscode.commands.executeCommand('chorus.openContext');
      }
    });

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to refresh index: ${error}`);
  }
}

/**
 * Clear current ballot
 */
async function clearBallot({ ballots, extension }: CommandContext): Promise<void> {
  try {
    const confirmation = await vscode.window.showWarningMessage(
      'Are you sure you want to clear the current ballot? This cannot be undone.',
      'Clear Ballot',
      'Cancel'
    );

    if (confirmation === 'Clear Ballot') {
      ballots.clearCurrentBallot();
      vscode.window.showInformationMessage('Current ballot cleared.');

      // Refresh panel if open
      if (extension) {
        await extension.openPanel('equity');
      }
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to clear ballot: ${error}`);
  }
}

/**
 * Reveal current ballot (make author visible)
 */
async function revealBallot({ ballots, extension }: CommandContext): Promise<void> {
  try {
    const currentBallot = ballots.getCurrentBallot();

    if (!currentBallot) {
      vscode.window.showInformationMessage('No active ballot to reveal.');
      return;
    }

    if (currentBallot.revealed) {
      vscode.window.showInformationMessage('Current ballot is already revealed.');
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      'Revealing your ballot will make your identity visible to others. This cannot be undone.',
      'Reveal Ballot',
      'Cancel'
    );

    if (confirmation === 'Reveal Ballot') {
      const result = ballots.revealBallot(currentBallot.id);

      if (result.success) {
        vscode.window.showInformationMessage(result.message);

        // Refresh panel if open
        if (extension) {
          await extension.openPanel('equity');
        }
      } else {
        vscode.window.showErrorMessage(result.message);
      }
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to reveal ballot: ${error}`);
  }
}

/**
 * Auto-detect test evidence from active editor
 */
async function autoDetectTestEvidence(
  evidence: Evidence,
  editor: vscode.TextEditor
): Promise<void> {
  try {
    if (!editor.document.fileName.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/)) {
      return; // Not a test file
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    if (selectedText.length > 10) {
      // Create evidence from selected test code
      evidence.createEvidenceFromSelection(
        'test',
        `Test: ${path.basename(editor.document.fileName)}`,
        selectedText,
        editor.document.fileName,
        selection.start.line + 1
      );
    }

  } catch (error) {
    console.error('Auto-detect test evidence failed:', error);
  }
}