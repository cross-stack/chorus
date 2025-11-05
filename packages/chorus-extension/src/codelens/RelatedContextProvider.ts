import * as vscode from 'vscode';
import { LocalDB } from '../storage/LocalDB';
import { Indexer } from '../services/Indexer';

export class RelatedContextProvider implements vscode.CodeLensProvider {
  private indexer: Indexer;

  constructor(db: LocalDB) {
    this.indexer = new Indexer(db);
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];

    try {
      // find relevant context for the current file
      const relevantContext = await this.indexer.findRelevantContext(document.fileName);

      if (relevantContext.length > 0) {
        // add CodeLens at the top of the file
        const range = new vscode.Range(0, 0, 0, 0);
        const codeLens = new vscode.CodeLens(range, {
          title: 'Related context (' + relevantContext.length + ')',
          command: 'chorus.showPanel',
          arguments: [{ filePath: document.fileName, context: relevantContext }],
        });
        codeLenses.push(codeLens);
      }

      // look for function/class definitions and add context for them
      const text = document.getText();
      const functionMatches = text.matchAll(/(?:function|class|interface|type)\s+(\w+)/g);

      for (const match of functionMatches) {
        const symbolName = match[1];
        const symbolContext = await this.indexer.findRelevantContext(document.fileName, symbolName);

        if (symbolContext.length > 0) {
          const position = document.positionAt(match.index || 0);
          const range = new vscode.Range(position, position);
          const codeLens = new vscode.CodeLens(range, {
            title: 'Related to ' + symbolName + ' (' + symbolContext.length + ')',
            command: 'chorus.showPanel',
            arguments: [
              {
                filePath: document.fileName,
                symbolName,
                context: symbolContext,
              },
            ],
          });
          codeLenses.push(codeLens);
        }
      }
    } catch (error) {
      console.error('Error providing CodeLenses:', error);
    }

    return codeLenses;
  }
}
