import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LocalDB, ContextEntry } from '../storage/LocalDB';
import { simpleGitLog } from './GitService';

export class Indexer {
	constructor(private db: LocalDB) {}

	async indexWorkspace(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			console.log('No workspace folders found');
			return;
		}

		console.log('Starting workspace indexing...');

		for (const folder of workspaceFolders) {
			const folderPath = folder.uri.fsPath;
			
			// Index git commits
			await this.indexGitCommits(folderPath);
			
			// Index documentation
			await this.indexDocuments(folderPath);
		}

		console.log('Workspace indexing completed');
	}

	private async indexGitCommits(workspacePath: string): Promise<void> {
		try {
			const commits = await simpleGitLog(workspacePath, 100); // Last 100 commits
			
			for (const commit of commits) {
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
						files: commit.files
					}
				};

				await this.db.addContextEntry(contextEntry);
			}

			console.log('Indexed ' + commits.length + ' git commits');
		} catch (error) {
			console.error('Failed to index git commits:', error);
		}
	}

	private async indexDocuments(workspacePath: string): Promise<void> {
		try {
			const docPatterns = ['**/README.md', '**/docs/**/*.md', '**/*.md'];
			
			for (const pattern of docPatterns) {
				const files = await vscode.workspace.findFiles(
					new vscode.RelativePattern(workspacePath, pattern),
					'**/node_modules/**'
				);

				for (const file of files) {
					await this.indexMarkdownFile(file);
				}
			}

			console.log('Document indexing completed');
		} catch (error) {
			console.error('Failed to index documents:', error);
		}
	}

	private async indexMarkdownFile(fileUri: vscode.Uri): Promise<void> {
		try {
			const content = await fs.readFile(fileUri.fsPath, 'utf-8');
			const relativePath = vscode.workspace.asRelativePath(fileUri);
			
			// Extract title from first heading or filename
			const titleMatch = content.match(/^#\s+(.+)$/m);
			const title = titleMatch ? titleMatch[1] : path.basename(fileUri.fsPath, '.md');

			const contextEntry: Omit<ContextEntry, 'id' | 'indexed_at'> = {
				type: 'doc',
				title: title,
				path: relativePath,
				content: content,
				metadata: {
					fileSize: content.length,
					extension: path.extname(fileUri.fsPath)
				}
			};

			await this.db.addContextEntry(contextEntry);
		} catch (error) {
			console.error('Failed to index file ' + fileUri.fsPath + ':', error);
		}
	}

	async findRelevantContext(filePath: string, symbolName?: string): Promise<ContextEntry[]> {
		const queries: string[] = [];
		
		// Add filename-based queries
		const fileName = path.basename(filePath, path.extname(filePath));
		queries.push(fileName);
		
		// Add symbol-based queries if provided
		if (symbolName) {
			queries.push(symbolName);
		}
		
		// Add directory-based queries
		const dirName = path.basename(path.dirname(filePath));
		queries.push(dirName);

		const allResults: ContextEntry[] = [];
		
		for (const query of queries) {
			const results = await this.db.searchContext(query);
			allResults.push(...results);
		}

		// Remove duplicates and rank by relevance
		const uniqueResults = this.deduplicateAndRank(allResults, queries);
		return uniqueResults.slice(0, 10); // Top 10 results
	}

	private deduplicateAndRank(entries: ContextEntry[], queries: string[]): ContextEntry[] {
		const uniqueMap = new Map<string, ContextEntry>();
		
		// Deduplicate by path
		for (const entry of entries) {
			const key = entry.type + ':' + entry.path;
			if (!uniqueMap.has(key)) {
				uniqueMap.set(key, entry);
			}
		}

		// Simple ranking: prefer recent commits and exact matches
		return Array.from(uniqueMap.values()).sort((a, b) => {
			// Prefer commits over docs
			if (a.type === 'commit' && b.type !== 'commit') return -1;
			if (b.type === 'commit' && a.type !== 'commit') return 1;
			
			// Prefer exact title matches
			const aHasExactMatch = queries.some(q => a.title.toLowerCase().includes(q.toLowerCase()));
			const bHasExactMatch = queries.some(q => b.title.toLowerCase().includes(q.toLowerCase()));
			
			if (aHasExactMatch && !bHasExactMatch) return -1;
			if (bHasExactMatch && !aHasExactMatch) return 1;
			
			// Default to indexed_at for tie-breaking (most recent first)
			return b.indexed_at.localeCompare(a.indexed_at);
		});
	}
}
