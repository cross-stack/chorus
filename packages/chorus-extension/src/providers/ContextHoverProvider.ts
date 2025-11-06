import * as vscode from 'vscode';
import { Indexer } from '../services/Indexer';
import { ContextEntry } from '../storage/LocalDB';

export class ContextHoverProvider implements vscode.HoverProvider {
  constructor(private indexer: Indexer) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // get word at position
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);

    // skip very short words (likely noise)
    if (word.length < 3) {
      return undefined;
    }

    try {
      // search for context related to word
      const context = await this.indexer.findRelevantContext(document.fileName, word);

      if (context.length === 0) {
        return undefined;
      }

      // build markdown hover content
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = true;
      markdown.supportHtml = true;

      markdown.appendMarkdown(`### 🎭 Related Context for "${word}"\n\n`);

      // show top 3 results
      const topResults = context.slice(0, 3);

      for (const item of topResults) {
        markdown.appendMarkdown(this.formatContextItem(item));
        markdown.appendMarkdown('\n\n---\n\n');
      }

      if (context.length > 3) {
        markdown.appendMarkdown(
          `*${context.length - 3} more result${context.length - 3 !== 1 ? 's' : ''}...*\n\n`
        );
      }

      // add action link to view all context
      markdown.appendMarkdown(
        `[View All Context](command:chorus.showContextPeek?${encodeURIComponent(JSON.stringify({ range: { start: wordRange.start, end: wordRange.end }, items: context }))})`
      );

      return new vscode.Hover(markdown, wordRange);
    } catch (error) {
      console.error('Error providing hover:', error);
      return undefined;
    }
  }

  private formatContextItem(item: ContextEntry): string {
    let markdown = '';

    if (item.type === 'commit') {
      const hash = (item.metadata['hash'] as string | undefined)?.substring(0, 7) || 'unknown';
      const author = (item.metadata['author'] as string | undefined) || 'Unknown';
      const date = item.metadata['date']
        ? new Date(item.metadata['date'] as string).toLocaleDateString()
        : 'Unknown';

      markdown += `**📝 Commit:** [${hash}](command:chorus.viewCommit?${encodeURIComponent(JSON.stringify({ hash: item.metadata['hash'] }))}) - ${item.title}\n\n`;
      markdown += `*${author} - ${date}*\n\n`;

      const files = item.metadata['files'] as string[] | undefined;
      if (files && files.length > 0) {
        markdown += `Files: ${files.slice(0, 3).join(', ')}`;
        if (files.length > 3) {
          markdown += ` (+${files.length - 3} more)`;
        }
      }
    } else if (item.type === 'doc') {
      markdown += `**📖 Documentation:** [${item.path}](command:chorus.openFile?${encodeURIComponent(JSON.stringify({ path: item.path }))})\n\n`;

      // show first 150 characters of content
      const preview = item.content.substring(0, 150).replace(/\n/g, ' ');
      markdown += `${preview}${item.content.length > 150 ? '...' : ''}`;
    } else if (item.type === 'pr') {
      markdown += `**🔀 Pull Request:** ${item.title}\n\n`;
      markdown += `Reference: ${item.path}`;
    }

    return markdown;
  }
}
