import * as vscode from 'vscode';
import { ChorusPanel } from './panel/ChorusPanel';
import { LocalDB } from './storage/LocalDB';
import { Indexer } from './services/Indexer';
import { RelatedContextProvider } from './codelens/RelatedContextProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Activating Chorus extension...');

  try {
    // initialize storage
    console.log('Creating LocalDB instance...');
    const db = new LocalDB(context.globalStorageUri.fsPath);
    console.log('Initializing database...');
    await db.initialize();
    console.log('Database initialized successfully');

    // initialize services (don't block activation on indexing)
    console.log('Creating Indexer instance...');
    const indexer = new Indexer(db);
    // index workspace in background to avoid blocking activation
    console.log('Starting background workspace indexing...');
    indexer.indexWorkspace().catch((err) => {
      console.error('Failed to index workspace:', err);
      vscode.window.showWarningMessage('Chorus: Failed to Index Workspace');
    });
    console.log('Indexer started');

    // register panel command
    console.log('Registering chorus.showPanel command...');
    const panelCommand = vscode.commands.registerCommand('chorus.showPanel', () => {
      console.log('chorus.showPanel command triggered');
      try {
        ChorusPanel.createOrShow(context.extensionUri, db);
      } catch (error) {
        console.error('Failed to show Chorus panel:', error);
        vscode.window.showErrorMessage(
          `Failed to Show Chorus Panel: ${error instanceof Error ? error.message : 'Unknown Error'}`
        );
      }
    });

    // register add evidence command
    console.log('Registering chorus.addEvidence command...');
    const addEvidenceCommand = vscode.commands.registerCommand('chorus.addEvidence', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
      }

      try {
        // get clipboard content
        const clipboardText = await vscode.env.clipboard.readText();

        // try to parse as test JSON
        let evidenceData = null;
        try {
          evidenceData = JSON.parse(clipboardText);
        } catch {
          // not JSON, use raw text
        }

        const evidenceBlock = formatEvidenceBlock(evidenceData, clipboardText);

        // insert evidence block
        await editor.edit((editBuilder) => {
          const position = editor.selection.active;
          editBuilder.insert(position, evidenceBlock);
        });

        vscode.window.showInformationMessage('Chorus Evidence block added successfully');
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to add evidence: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    // register CodeLens provider
    console.log('Registering CodeLens provider...');
    const codeLensProvider = new RelatedContextProvider(db);
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'typescript' },
      codeLensProvider
    );

    console.log('Adding disposables to context...');
    context.subscriptions.push(panelCommand, addEvidenceCommand, codeLensDisposable, db);

    // set context for conditional UI
    console.log('Setting chorus.enabled context...');
    await vscode.commands.executeCommand('setContext', 'chorus.enabled', true);

    console.log('✅ Chorus extension activated successfully');
  } catch (error) {
    console.error('Failed to activate Chorus extension:', error);
    vscode.window.showErrorMessage(
      `Failed to Activate Chorus Extension: ${error instanceof Error ? error.message : 'Unknown Error'}`
    );
    throw error;
  }
}

export function deactivate(): void {
  console.log('Deactivating Chorus extension...');
}

function formatEvidenceBlock(evidenceData: any, rawText: string): string {
  const timestamp = new Date().toISOString();

  // check for test data patterns
  let testsSection = '';
  let benchmarksSection = '';

  if (evidenceData) {
    // handle common test frameworks
    if (evidenceData.testResults || evidenceData.tests) {
      testsSection = formatTestResults(evidenceData);
    } else if (evidenceData.coverage) {
      testsSection = formatCoverageData(evidenceData);
    } else if (evidenceData.numPassedTests !== undefined) {
      testsSection = formatJestResults(evidenceData);
    }

    // handle benchmark data
    if (evidenceData.benchmarks || evidenceData.performance) {
      benchmarksSection = formatBenchmarkData(evidenceData);
    }
  }

  // fallback to raw text if no structured data
  if (!testsSection && rawText.trim()) {
    testsSection = `\`\`\`\n${rawText.trim()}\n\`\`\``;
  }

  return `
<details>
<summary><strong>🎭 Chorus Evidence</strong> - ${timestamp}</summary>

### Tests
${testsSection || '**Status**: [ ] Complete [ ] In Progress [ ] N/A\n\n**Details**: _Add test information here_'}

### Benchmarks
${benchmarksSection || '**Status**: [ ] Complete [ ] In Progress [ ] N/A\n\n**Details**: _Add performance metrics or mark N/A_'}

### Specification/ADR References
**Status**: [ ] Complete [ ] In Progress [ ] N/A

**References**: _Add links to specs, ADRs, or design documents_

### Risk Assessment & Rollback Plan
**Risk Level**: [ ] Low [ ] Medium [ ] High

**Identified Risks**: _List potential risks_

**Rollback Plan**: _Describe rollback strategy_

</details>
`;
}

function formatTestResults(data: any): string {
  if (data.testResults) {
    const passed = data.testResults.filter((t: any) => t.status === 'passed').length;
    const failed = data.testResults.filter((t: any) => t.status === 'failed').length;
    return `**Status**: ✅ Complete\n\n**Results**: ${passed} passed, ${failed} failed\n**Coverage**: ${data.coverage?.pct || 'N/A'}%`;
  }
  return `**Status**: ✅ Complete\n\n**Details**: Test results processed`;
}

function formatCoverageData(data: any): string {
  const { lines, functions, branches, statements } = data.coverage.total || data.coverage;
  return `**Status**: ✅ Complete

**Coverage Report**:
- Lines: ${lines?.pct || 'N/A'}%
- Functions: ${functions?.pct || 'N/A'}%
- Branches: ${branches?.pct || 'N/A'}%
- Statements: ${statements?.pct || 'N/A'}%`;
}

function formatJestResults(data: any): string {
  return `**Status**: ${data.success ? '✅ Complete' : '❌ Failed'}

**Jest Results**:
- Passed: ${data.numPassedTests || 0}
- Failed: ${data.numFailedTests || 0}
- Skipped: ${data.numPendingTests || 0}
- Duration: ${data.testExecTime || 'N/A'}ms`;
}

function formatBenchmarkData(data: any): string {
  if (data.benchmarks) {
    return `**Status**: ✅ Complete\n\n**Benchmark Results**: ${data.benchmarks.length} tests completed`;
  }
  return `**Status**: ✅ Complete\n\n**Performance**: Metrics captured`;
}
