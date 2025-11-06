import * as vscode from 'vscode';
import * as path from 'path';
import { LocalDB, ContextEntry } from '../storage/LocalDB';
import { Indexer } from '../services/Indexer';

export class ContextItem extends vscode.TreeItem {
  public override readonly contextValue: string;
  public readonly data?: any;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string = 'default',
    data?: any
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    this.data = data;

    // set icon based on context value
    if (contextValue === 'commit') {
      this.iconPath = new vscode.ThemeIcon('git-commit');
    } else if (contextValue === 'doc') {
      this.iconPath = new vscode.ThemeIcon('book');
    } else if (contextValue === 'pr') {
      this.iconPath = new vscode.ThemeIcon('git-pull-request');
    } else if (contextValue === 'section') {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }
}

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ContextItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentFilePath: string | undefined;

  constructor(
    // db reserved for future use (active reviews, ballot tracking)
    _db: LocalDB,
    private indexer: Indexer
  ) {
    // listen to active editor changes to update context
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        this.currentFilePath = editor.document.fileName;
        this.refresh();
      }
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ContextItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ContextItem): Promise<ContextItem[]> {
    if (!element) {
      // root level - show main sections
      const sections: ContextItem[] = [
        new ContextItem(
          'Current File Context',
          vscode.TreeItemCollapsibleState.Expanded,
          'section'
        ),
        new ContextItem(
          'Active Reviews',
          vscode.TreeItemCollapsibleState.Expanded,
          'section'
        ),
        new ContextItem(
          'Recent Searches',
          vscode.TreeItemCollapsibleState.Collapsed,
          'section'
        ),
      ];
      return sections;
    }

    // handle children for specific sections
    if (element.contextValue === 'section') {
      if (element.label === 'Current File Context') {
        return this.getCurrentFileContextItems();
      } else if (element.label === 'Active Reviews') {
        return this.getActiveReviewsItems();
      } else if (element.label === 'Recent Searches') {
        return this.getRecentSearchesItems();
      }
    } else if (element.contextValue === 'contextCategory') {
      // handle expandable categories like "Related Commits (3)"
      return this.getCategoryItems(element);
    }

    return [];
  }

  private async getCurrentFileContextItems(): Promise<ContextItem[]> {
    if (!this.currentFilePath) {
      const noFileItem = new ContextItem(
        'No file selected',
        vscode.TreeItemCollapsibleState.None,
        'empty'
      );
      return [noFileItem];
    }

    try {
      // find relevant context for current file
      const context = await this.indexer.findRelevantContext(this.currentFilePath);

      if (context.length === 0) {
        const noContextItem = new ContextItem(
          'No related context found',
          vscode.TreeItemCollapsibleState.None,
          'empty'
        );
        return [noContextItem];
      }

      // group context by type
      const commits = context.filter((c) => c.type === 'commit');
      const docs = context.filter((c) => c.type === 'doc');

      const items: ContextItem[] = [];

      // add commits category
      if (commits.length > 0) {
        const commitsCategory = new ContextItem(
          `Related Commits (${commits.length})`,
          vscode.TreeItemCollapsibleState.Expanded,
          'contextCategory',
          { type: 'commit', items: commits }
        );
        items.push(commitsCategory);
      }

      // add docs category
      if (docs.length > 0) {
        const docsCategory = new ContextItem(
          `Related Docs (${docs.length})`,
          vscode.TreeItemCollapsibleState.Expanded,
          'contextCategory',
          { type: 'doc', items: docs }
        );
        items.push(docsCategory);
      }

      // TODO: fetch github pr data for active reviews tree section
      // TODO: link ballot submissions to github pr comments
      const prsCategory = new ContextItem(
        'Related PRs (0)',
        vscode.TreeItemCollapsibleState.Collapsed,
        'contextCategory',
        { type: 'pr', items: [] }
      );
      items.push(prsCategory);

      return items;
    } catch (error) {
      console.error('Error getting file context:', error);
      const errorItem = new ContextItem(
        'Error loading context',
        vscode.TreeItemCollapsibleState.None,
        'error'
      );
      return [errorItem];
    }
  }

  private getCategoryItems(category: ContextItem): ContextItem[] {
    if (!category.data || !category.data.items) {
      return [];
    }

    const items: ContextItem[] = [];
    const contextEntries = category.data.items as ContextEntry[];

    for (const entry of contextEntries.slice(0, 10)) {
      // limit to 10 items
      const item = new ContextItem(
        this.formatContextItemLabel(entry),
        vscode.TreeItemCollapsibleState.None,
        entry.type,
        entry
      );

      // add tooltip
      item.tooltip = this.formatTooltip(entry);

      // add command to view context
      item.command = {
        command: 'chorus.viewContextItem',
        title: 'View Context',
        arguments: [entry],
      };

      items.push(item);
    }

    return items;
  }

  private formatContextItemLabel(entry: ContextEntry): string {
    if (entry.type === 'commit') {
      const hash = (entry.metadata['hash'] as string | undefined)?.substring(0, 7) || 'unknown';
      return `[${hash}] ${entry.title}`;
    } else if (entry.type === 'doc') {
      return path.basename(entry.path);
    } else if (entry.type === 'pr') {
      return `PR ${entry.path}: ${entry.title}`;
    }
    return entry.title;
  }

  private formatTooltip(entry: ContextEntry): string {
    if (entry.type === 'commit') {
      const author = (entry.metadata['author'] as string | undefined) || 'Unknown';
      const date = entry.metadata['date']
        ? new Date(entry.metadata['date'] as string).toLocaleDateString()
        : 'Unknown date';
      return `${entry.title}\n\nAuthor: ${author}\nDate: ${date}`;
    } else if (entry.type === 'doc') {
      return `${entry.path}\n\n${entry.content.substring(0, 200)}...`;
    }
    return entry.title;
  }

  private async getActiveReviewsItems(): Promise<ContextItem[]> {
    // TODO: show pr review status in tree view (approved/rejected/pending)
    // privacy note: github api calls are read-only and opt-in

    // for now, show placeholder - ballots are not stored as context entries
    // they are in a separate table, so we can't easily list them here without
    // adding a dedicated method to LocalDB
    const items: ContextItem[] = [];

    items.push(
      new ContextItem(
        'No active reviews',
        vscode.TreeItemCollapsibleState.None,
        'empty'
      )
    );

    return items;
  }

  private getRecentSearchesItems(): ContextItem[] {
    // TODO: implement search history tracking
    const items: ContextItem[] = [];

    items.push(
      new ContextItem(
        'Search history not yet implemented',
        vscode.TreeItemCollapsibleState.None,
        'empty'
      )
    );

    return items;
  }
}
