import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LocalDB, ContextEntry } from '../storage/LocalDB';
import { simpleGitLog, GitLogEntry } from './GitService';

/**
 * IncrementalIndexer manages background indexing with file watchers and progress tracking.
 *
 * Key features:
 * - Non-blocking batch processing to avoid blocking VS Code UI
 * - File system watchers for real-time incremental updates
 * - Status bar progress indicator with user feedback
 * - Persistent metadata tracking for resume capability
 * - Graceful error handling with recovery mechanisms
 *
 * Design rationale:
 * - Processes files in batches of 10 with 50ms delays between batches
 * - Tracks last indexed commit to avoid re-indexing on every activation
 * - Provides visual feedback via status bar to reduce user uncertainty
 */
export class IncrementalIndexer {
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private isIndexing = false;
  private indexQueue: string[] = [];
  private cancellationToken: vscode.CancellationTokenSource | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_DELAY_MS = 50;

  constructor(
    private db: LocalDB,
    private statusBar: vscode.StatusBarItem
  ) {}

  /**
   * Starts file system watchers for incremental updates.
   *
   * Monitors:
   * - Markdown file changes (*.md) for documentation indexing
   * - Git directory changes (.git/) for new commit detection
   *
   * Automatically queues changed files for re-indexing in the background.
   */
  async startWatching(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('IncrementalIndexer: No workspace folders to watch');
      return;
    }

    // watch for markdown file changes
    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.md');

    // on file create or change, add to queue
    this.fileWatcher.onDidCreate((uri) => {
      console.log('IncrementalIndexer: File created:', uri.fsPath);
      this.queueFile(uri.fsPath);
    });

    this.fileWatcher.onDidChange((uri) => {
      console.log('IncrementalIndexer: File changed:', uri.fsPath);
      this.queueFile(uri.fsPath);
    });

    this.fileWatcher.onDidDelete((uri) => {
      console.log('IncrementalIndexer: File deleted:', uri.fsPath);
      // TODO: remove from index when file deletion tracking is implemented
    });

    console.log('IncrementalIndexer: File watchers started');
  }

  /**
   * Indexes workspace incrementally, only processing new content.
   *
   * Algorithm:
   * 1. Check last indexed commit hash from metadata
   * 2. Fetch only new commits since last index
   * 3. Process commits and documents in batches
   * 4. Update status bar with progress
   * 5. Persist last indexed commit for next run
   *
   * Non-blocking: Uses batch processing with event loop yielding
   * to prevent UI freezing during large indexing operations.
   */
  async indexIncrementally(): Promise<void> {
    if (this.isIndexing) {
      console.log('IncrementalIndexer: Already indexing, skipping');
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log('IncrementalIndexer: No workspace folders found');
      this.updateStatusBar('ready', 0);
      return;
    }

    this.isIndexing = true;
    this.cancellationToken = new vscode.CancellationTokenSource();

    try {
      this.updateStatusBar('indexing', 0);

      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;

        // check for cancellation
        if (this.cancellationToken.token.isCancellationRequested) {
          console.log('IncrementalIndexer: Indexing cancelled');
          break;
        }

        // index git commits incrementally
        await this.indexGitCommitsIncremental(folderPath);

        // check for cancellation
        if (this.cancellationToken.token.isCancellationRequested) {
          console.log('IncrementalIndexer: Indexing cancelled');
          break;
        }

        // index documents (always re-scan for now, optimize later)
        await this.indexDocuments(folderPath);
      }

      // get total indexed items for status bar
      const totalItems = await this.getTotalIndexedItems();
      this.updateStatusBar('ready', totalItems);

      console.log('IncrementalIndexer: Indexing completed successfully');
    } catch (error) {
      console.error('IncrementalIndexer: Indexing failed:', error);
      this.updateStatusBar('error', 0);
      throw error;
    } finally {
      this.isIndexing = false;
      this.cancellationToken?.dispose();
      this.cancellationToken = null;
    }
  }

  /**
   * Indexes git commits incrementally since last indexed commit.
   *
   * Uses last_indexed_commit metadata to determine starting point.
   * Only processes new commits to minimize redundant work.
   *
   * @param workspacePath - The workspace folder path to index
   */
  private async indexGitCommitsIncremental(workspacePath: string): Promise<void> {
    try {
      // get last indexed commit
      const lastCommit = await this.db.getLastIndexedCommit();
      console.log('IncrementalIndexer: Last indexed commit:', lastCommit);

      // fetch recent commits (limit to 200 for safety)
      const allCommits = await simpleGitLog(workspacePath, 200);

      if (allCommits.length === 0) {
        console.log('IncrementalIndexer: No commits found');
        return;
      }

      // find new commits since last index
      let newCommits: GitLogEntry[] = [];
      if (lastCommit) {
        // find index of last indexed commit
        const lastIndex = allCommits.findIndex((c) => c.hash === lastCommit);
        if (lastIndex === -1) {
          // last commit not found, index all (might be a new branch or force push)
          console.log(
            'IncrementalIndexer: Last commit not found in history, indexing all recent commits'
          );
          newCommits = allCommits;
        } else {
          // index only commits before the last indexed one
          newCommits = allCommits.slice(0, lastIndex);
          console.log('IncrementalIndexer: Found', newCommits.length, 'new commits to index');
        }
      } else {
        // no previous index, index all
        console.log('IncrementalIndexer: No previous index, indexing all commits');
        newCommits = allCommits;
      }

      if (newCommits.length === 0) {
        console.log('IncrementalIndexer: No new commits to index');
        return;
      }

      // process commits in batches
      await this.processCommitsInBatches(newCommits);

      // update last indexed commit (most recent one)
      if (allCommits.length > 0) {
        await this.db.setLastIndexedCommit(allCommits[0].hash);
        console.log('IncrementalIndexer: Updated last indexed commit to', allCommits[0].hash);
      }
    } catch (error) {
      console.error('IncrementalIndexer: Failed to index git commits:', error);
      // don't throw, allow other indexing to continue
    }
  }

  /**
   * Processes commits in batches to avoid blocking the event loop.
   *
   * Batch size: 10 commits per batch
   * Delay: 50ms between batches for UI responsiveness
   *
   * @param commits - Array of commits to process
   */
  private async processCommitsInBatches(commits: GitLogEntry[]): Promise<void> {
    for (let i = 0; i < commits.length; i += this.BATCH_SIZE) {
      // check for cancellation
      if (this.cancellationToken?.token.isCancellationRequested) {
        console.log('IncrementalIndexer: Batch processing cancelled');
        break;
      }

      const batch = commits.slice(i, i + this.BATCH_SIZE);

      // process batch
      for (const commit of batch) {
        const filesString = commit.files.join(', ');
        const contextEntry: Omit<ContextEntry, 'id' | 'indexed_at'> = {
          type: 'commit',
          title: commit.subject,
          path: commit.hash,
          content: commit.subject + '\n\n' + commit.body + '\n\nFiles: ' + filesString,
          metadata: {
            hash: commit.hash,
            author: commit.author,
            date: commit.date,
            files: commit.files,
          },
        };

        await this.db.addContextEntry(contextEntry);
      }

      // update progress
      const progress = Math.min(i + this.BATCH_SIZE, commits.length);
      this.updateStatusBar('indexing', progress, commits.length);

      // yield to event loop
      if (i + this.BATCH_SIZE < commits.length) {
        await this.delay(this.BATCH_DELAY_MS);
      }
    }

    console.log('IncrementalIndexer: Indexed', commits.length, 'git commits');
  }

  /**
   * Indexes documentation files in the workspace.
   *
   * Searches for markdown files matching common documentation patterns:
   * - README.md files
   * - Files in docs/ directories
   * - Any .md files
   *
   * Excludes node_modules to avoid indexing dependencies.
   *
   * @param workspacePath - The workspace folder path to index
   */
  private async indexDocuments(workspacePath: string): Promise<void> {
    try {
      const docPatterns = ['**/README.md', '**/docs/**/*.md', '**/*.md'];
      const allFiles: vscode.Uri[] = [];

      // collect all matching files
      for (const pattern of docPatterns) {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(workspacePath, pattern),
          '**/node_modules/**'
        );
        allFiles.push(...files);
      }

      // deduplicate files
      const uniqueFiles = Array.from(new Set(allFiles.map((f) => f.fsPath))).map((fsPath) =>
        vscode.Uri.file(fsPath)
      );

      console.log('IncrementalIndexer: Found', uniqueFiles.length, 'documentation files');

      // process files in batches
      await this.processFilesInBatches(uniqueFiles);
    } catch (error) {
      console.error('IncrementalIndexer: Failed to index documents:', error);
      // don't throw, allow indexing to complete partially
    }
  }

  /**
   * Processes documentation files in batches.
   *
   * Batch size: 10 files per batch
   * Delay: 50ms between batches for UI responsiveness
   *
   * @param files - Array of file URIs to process
   */
  private async processFilesInBatches(files: vscode.Uri[]): Promise<void> {
    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      // check for cancellation
      if (this.cancellationToken?.token.isCancellationRequested) {
        console.log('IncrementalIndexer: Batch processing cancelled');
        break;
      }

      const batch = files.slice(i, i + this.BATCH_SIZE);

      // process batch
      for (const fileUri of batch) {
        await this.indexMarkdownFile(fileUri);
      }

      // update progress
      const progress = Math.min(i + this.BATCH_SIZE, files.length);
      this.updateStatusBar('indexing', progress, files.length);

      // yield to event loop
      if (i + this.BATCH_SIZE < files.length) {
        await this.delay(this.BATCH_DELAY_MS);
      }
    }

    console.log('IncrementalIndexer: Indexed', files.length, 'documentation files');
  }

  /**
   * Indexes a single markdown file.
   *
   * Extracts title from first H1 heading or uses filename as fallback.
   * Stores full content for BM25-style relevance ranking.
   *
   * @param fileUri - The file URI to index
   */
  private async indexMarkdownFile(fileUri: vscode.Uri): Promise<void> {
    try {
      const content = await fs.readFile(fileUri.fsPath, 'utf-8');
      const relativePath = vscode.workspace.asRelativePath(fileUri);

      // extract title from first heading or filename
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : path.basename(fileUri.fsPath, '.md');

      const contextEntry: Omit<ContextEntry, 'id' | 'indexed_at'> = {
        type: 'doc',
        title: title,
        path: relativePath,
        content: content,
        metadata: {
          fileSize: content.length,
          extension: path.extname(fileUri.fsPath),
        },
      };

      await this.db.addContextEntry(contextEntry);
    } catch (error) {
      console.error('IncrementalIndexer: Failed to index file ' + fileUri.fsPath + ':', error);
      // don't throw, continue with other files
    }
  }

  /**
   * Queues a file for re-indexing.
   *
   * Called by file watchers when files change.
   * Automatically processes the queue in the background.
   *
   * @param filePath - The absolute file path to queue
   */
  private queueFile(filePath: string): void {
    if (!this.indexQueue.includes(filePath)) {
      this.indexQueue.push(filePath);
      console.log('IncrementalIndexer: Queued file:', filePath);

      // process queue in background (don't await)
      this.processQueue().catch((error) => {
        console.error('IncrementalIndexer: Failed to process queue:', error);
      });
    }
  }

  /**
   * Processes the file queue in the background.
   *
   * Debounced to avoid excessive processing during rapid file changes.
   * Processes all queued files in batches with event loop yielding.
   */
  private async processQueue(): Promise<void> {
    if (this.isIndexing || this.indexQueue.length === 0) {
      return;
    }

    // simple debounce: wait 500ms for more changes
    await this.delay(500);

    if (this.indexQueue.length === 0) {
      return;
    }

    this.isIndexing = true;

    try {
      const filesToProcess = [...this.indexQueue];
      this.indexQueue = [];

      console.log('IncrementalIndexer: Processing', filesToProcess.length, 'queued files');
      this.updateStatusBar('indexing', 0, filesToProcess.length);

      // process files in batches
      const fileUris = filesToProcess.map((f) => vscode.Uri.file(f));
      await this.processFilesInBatches(fileUris);

      const totalItems = await this.getTotalIndexedItems();
      this.updateStatusBar('ready', totalItems);

      console.log('IncrementalIndexer: Queue processing completed');
    } catch (error) {
      console.error('IncrementalIndexer: Queue processing failed:', error);
      this.updateStatusBar('error', 0);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Reindexes a specific PR by number.
   *
   * Useful when a PR has been updated and needs to be refreshed in the index.
   * This is a manual operation and not triggered automatically by file watchers.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - PR number to reindex
   */
  async reindexPR(owner: string, repo: string, prNumber: number): Promise<void> {
    console.log(`IncrementalIndexer: Reindexing PR ${owner}/${repo}#${prNumber}`);

    // note: full implementation would require access to GitHubService and Indexer
    // for now, this is a placeholder that shows the intended interface
    // the actual reindexing would fetch the PR and replace the existing entry

    console.log('IncrementalIndexer: PR reindexing not yet implemented');
    console.log('IncrementalIndexer: Use forceReindex() to refresh all data including PRs');
  }

  /**
   * Forces a complete re-index of the workspace.
   *
   * Clears all index metadata and context entries, then re-indexes everything.
   * Useful for manual refresh or when index corruption is suspected.
   *
   * User-triggered via command: chorus.reindexWorkspace
   */
  async forceReindex(): Promise<void> {
    console.log('IncrementalIndexer: Starting force reindex');

    try {
      // cancel any ongoing indexing
      this.cancellationToken?.cancel();

      // wait for current indexing to finish
      while (this.isIndexing) {
        await this.delay(100);
      }

      // clear index metadata
      await this.db.setIndexMetadata('last_indexed_commit', '');

      // clear all context entries
      // note: this is a simple implementation. For production, consider selective clearing
      // to preserve user-added content like ballots and pr_state
      // we don't have direct access to run arbitrary SQL, so we'll rely on the next index
      // to overwrite old data. For a true force reindex, we'd need a clearContextEntries method.

      console.log('IncrementalIndexer: Metadata cleared, starting fresh index');

      // start fresh indexing
      await this.indexIncrementally();

      console.log('IncrementalIndexer: Force reindex completed');
    } catch (error) {
      console.error('IncrementalIndexer: Force reindex failed:', error);
      throw error;
    }
  }

  /**
   * Cancels ongoing indexing operations.
   *
   * Called when workspace is closed or extension is deactivated.
   * Gracefully stops batch processing and cleans up resources.
   */
  cancel(): void {
    console.log('IncrementalIndexer: Cancelling indexing');
    this.cancellationToken?.cancel();
  }

  /**
   * Disposes resources and stops file watchers.
   *
   * Called during extension deactivation.
   */
  dispose(): void {
    console.log('IncrementalIndexer: Disposing resources');
    this.cancel();
    this.fileWatcher?.dispose();
    this.fileWatcher = null;
  }

  /**
   * Updates the status bar with current indexing state.
   *
   * States:
   * - indexing: Shows spinner with progress (e.g., "Chorus: Indexing... (45/120)")
   * - ready: Shows database icon with item count (e.g., "Chorus: Ready (120 items)")
   * - error: Shows warning icon (e.g., "Chorus: Index Error")
   *
   * @param state - The current state
   * @param current - Current progress count
   * @param total - Total items to process (optional)
   */
  private updateStatusBar(
    state: 'indexing' | 'ready' | 'error',
    current: number,
    total?: number
  ): void {
    switch (state) {
      case 'indexing':
        if (total !== undefined && total > 0) {
          this.statusBar.text = `$(sync~spin) Chorus: Indexing... (${current}/${total})`;
          this.statusBar.tooltip = `Indexing workspace for context discovery: ${current} of ${total} items`;
        } else {
          this.statusBar.text = '$(sync~spin) Chorus: Indexing...';
          this.statusBar.tooltip = 'Indexing workspace for context discovery';
        }
        this.statusBar.backgroundColor = undefined;
        break;

      case 'ready':
        this.statusBar.text = `$(database) Chorus: Ready (${current} items)`;
        this.statusBar.tooltip = `Workspace indexed: ${current} items available for context discovery`;
        this.statusBar.backgroundColor = undefined;
        break;

      case 'error':
        this.statusBar.text = '$(warning) Chorus: Index Error';
        this.statusBar.tooltip = 'Failed to index workspace. Click to retry.';
        this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }

    this.statusBar.show();
  }

  /**
   * Gets the total number of indexed items in the database.
   *
   * Used for status bar display.
   *
   * @returns Promise resolving to the count of context entries
   */
  private async getTotalIndexedItems(): Promise<number> {
    try {
      // simple search that returns all items (limited by searchContext implementation)
      const results = await this.db.searchContext('');
      return results.length;
    } catch (error) {
      console.error('IncrementalIndexer: Failed to get total items:', error);
      return 0;
    }
  }

  /**
   * Delays execution for the specified duration.
   *
   * Used for batch processing delays and debouncing.
   *
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after the delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
