import * as vscode from 'vscode';
import { Indexer } from '../services/Indexer';
import { ContextItem } from '../types';

export class RelatedContextLens implements vscode.CodeLensProvider {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private indexer: Indexer) {}

  /**
   * Provide CodeLens for files with relevant context
   */
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    // Only show CodeLens for files in workspace
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return [];
    }

    // Skip certain file types
    if (this.shouldSkipFile(document)) {
      return [];
    }

    try {
      // Get changed lines from document (simplified - in real usage, this would compare with git)
      const changedLines = this.getChangedLines(document);

      if (changedLines.length === 0) {
        return [];
      }

      // Find related context using the indexer
      const relatedItems = await this.indexer.findRelatedContext(
        document.fileName,
        changedLines
      );

      if (relatedItems.length === 0) {
        return [];
      }

      // Create CodeLens at the top of the file
      const topOfFile = new vscode.Range(0, 0, 0, 0);

      const codeLens = new vscode.CodeLens(topOfFile, {
        title: `Related context (${relatedItems.length})`,
        tooltip: this.createTooltip(relatedItems),
        command: 'chorus.openContext',
        arguments: [{ filePath: document.fileName, relatedItems }],
      });

      return [codeLens];
    } catch (error) {
      console.error('CodeLens provider error:', error);
      return [];
    }
  }

  /**
   * Refresh CodeLens for all documents
   */
  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  private shouldSkipFile(document: vscode.TextDocument): boolean {
    const filePath = document.fileName;

    // Skip binary files, generated files, dependencies
    const skipPatterns = [
      /node_modules/,
      /\.git\//,
      /\.vscode/,
      /\.min\.(js|css)$/,
      /\.d\.ts$/,
      /\.(png|jpg|jpeg|gif|svg|ico|pdf)$/i,
      /package-lock\.json$/,
      /yarn\.lock$/,
      /out\//,
      /dist\//,
      /build\//,
    ];

    return skipPatterns.some(pattern => pattern.test(filePath));
  }

  private getChangedLines(document: vscode.TextDocument): string[] {
    // Simplified implementation - get all lines
    // In a real implementation, this would:
    // 1. Compare with git working tree to find actual changes
    // 2. Only return modified lines
    // 3. Handle different change types (additions, modifications, deletions)

    const lines: string[] = [];
    const lineCount = Math.min(document.lineCount, 50); // Limit to first 50 lines for demo

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      if (line.text.trim().length > 0) {
        lines.push(line.text.trim());
      }
    }

    return lines;
  }

  private createTooltip(relatedItems: ContextItem[]): string {
    const itemTypes = relatedItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeSummary = Object.entries(itemTypes)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');

    const topItems = relatedItems
      .slice(0, 3)
      .map(item => `" ${item.title}`)
      .join('\n');

    return `Found ${relatedItems.length} related items:\n${typeSummary}\n\nTop matches:\n${topItems}\n\nClick to view all in Context panel`;
  }
}