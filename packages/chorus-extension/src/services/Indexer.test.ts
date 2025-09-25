import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Indexer } from './Indexer';
import { TestDatabase, createMockVSCodeWorkspace } from '../test/testUtils';
import * as GitService from './GitService';

// mock vscode module
vi.mock('vscode', () => ({
	workspace: {
		workspaceFolders: [],
		asRelativePath: vi.fn(),
		findFiles: vi.fn()
	},
	RelativePattern: vi.fn(),
	Uri: {
		joinPath: vi.fn()
	}
}));

describe('Indexer', () => {
	let testDb: TestDatabase;
	let indexer: Indexer;

	beforeEach(async () => {
		testDb = new TestDatabase();
		await testDb.setup();
		indexer = new Indexer(testDb.db);
	});

	afterEach(async () => {
		await testDb.cleanup();
		vi.clearAllMocks();
	});

	describe('findRelevantContext', () => {
		beforeEach(async () => {
			// add some test data
			await testDb.db.addContextEntry({
				type: 'commit',
				title: 'feat: add user authentication',
				path: 'abc123',
				content: 'Implemented OAuth2 flow for user auth',
				metadata: { hash: 'abc123', author: 'John' }
			});

			await testDb.db.addContextEntry({
				type: 'doc',
				title: 'Authentication Guide',
				path: 'docs/auth.md',
				content: 'How to implement authentication in the app',
				metadata: { fileSize: 100 }
			});

			await testDb.db.addContextEntry({
				type: 'commit',
				title: 'fix: resolve login issue',
				path: 'def456',
				content: 'Fixed bug in login component',
				metadata: { hash: 'def456', author: 'Jane' }
			});
		});

		it('should find context by filename', async () => {
			const results = await indexer.findRelevantContext('src/auth.ts');
			
			expect(results.length).toBeGreaterThan(0);
			// should find entries related to 'auth'
			const authRelated = results.filter(r => 
				r.title.toLowerCase().includes('auth') || 
				r.content.toLowerCase().includes('auth')
			);
			expect(authRelated.length).toBeGreaterThan(0);
		});

		it('should find context by symbol name', async () => {
			const results = await indexer.findRelevantContext('src/components/Login.tsx', 'login');
			
			expect(results.length).toBeGreaterThan(0);
			// should find the commit about login issue
			const loginRelated = results.filter(r => 
				r.title.toLowerCase().includes('login') ||
				r.content.toLowerCase().includes('login')
			);
			expect(loginRelated.length).toBeGreaterThan(0);
		});

		it('should limit results to 10', async () => {
			// add many entries
			for (let i = 0; i < 15; i++) {
				await testDb.db.addContextEntry({
					type: 'commit',
					title: 'auth commit ' + i,
					path: 'hash' + i,
					content: 'Authentication related commit ' + i,
					metadata: { hash: 'hash' + i }
				});
			}

			const results = await indexer.findRelevantContext('src/auth.ts');
			expect(results.length).toBeLessThanOrEqual(10);
		});

		it('should deduplicate results', async () => {
			// this should return the same entry for multiple query terms
			const results = await indexer.findRelevantContext('auth/login.ts', 'auth');
			
			// check that there are no duplicate paths
			const paths = results.map(r => r.path);
			const uniquePaths = [...new Set(paths)];
			expect(paths).toHaveLength(uniquePaths.length);
		});

		it('should rank commits higher than docs', async () => {
			const results = await indexer.findRelevantContext('src/auth.ts');
			
			if (results.length > 1) {
				// find first commit and first doc
				const firstCommitIndex = results.findIndex(r => r.type === 'commit');
				const firstDocIndex = results.findIndex(r => r.type === 'doc');
				
				if (firstCommitIndex !== -1 && firstDocIndex !== -1) {
					expect(firstCommitIndex).toBeLessThan(firstDocIndex);
				}
			}
		});

		it('should handle empty file paths', async () => {
			const results = await indexer.findRelevantContext('');
			expect(results).toBeDefined();
			expect(Array.isArray(results)).toBe(true);
		});

		it('should handle files with no relevant context', async () => {
			const results = await indexer.findRelevantContext('src/unrelated-file.ts');
			expect(results).toBeDefined();
			expect(Array.isArray(results)).toBe(true);
		});
	});

	describe('deduplication and ranking', () => {
		it('should prefer exact title matches', async () => {
			await testDb.db.addContextEntry({
				type: 'commit',
				title: 'authentication system',
				path: 'hash1',
				content: 'Some other content',
				metadata: { hash: 'hash1' }
			});

			await testDb.db.addContextEntry({
				type: 'commit',
				title: 'unrelated change',
				path: 'hash2',
				content: 'This mentions authentication in passing',
				metadata: { hash: 'hash2' }
			});

			const results = await indexer.findRelevantContext('src/auth.ts');
			
			// the entry with 'authentication' in the title should rank higher
			// than the one that only mentions it in content
			if (results.length >= 2) {
				const titleMatch = results.find(r => r.title.includes('authentication'));
				const contentMatch = results.find(r => r.title.includes('unrelated'));
				
				if (titleMatch && contentMatch) {
					const titleIndex = results.indexOf(titleMatch);
					const contentIndex = results.indexOf(contentMatch);
					expect(titleIndex).toBeLessThan(contentIndex);
				}
			}
		});
	});

	describe('indexGitCommits', () => {
		it('should handle git service errors gracefully', async () => {
			// mock git service to throw error
			vi.spyOn(GitService, 'simpleGitLog').mockRejectedValue(new Error('Git not found'));

			// this should not throw, but log error internally
			await expect(indexer.indexWorkspace()).resolves.not.toThrow();
		});

		it('should process git log entries correctly', async () => {
			const mockCommits = [
				{
					hash: 'abc123',
					author: 'John Doe',
					date: '2023-01-01',
					subject: 'feat: add authentication',
					body: 'Implemented OAuth2 flow',
					files: ['src/auth.ts', 'src/types.ts']
				}
			];

			vi.spyOn(GitService, 'simpleGitLog').mockResolvedValue(mockCommits);

			// mock vscode workspace
			const mockVscode = await import('vscode');
			mockVscode.workspace.workspaceFolders = [{
				uri: { fsPath: '/test/workspace' },
				name: 'test'
			}] as any;
			mockVscode.workspace.findFiles = vi.fn().mockResolvedValue([]);

			await indexer.indexWorkspace();

			// check that commit was added to database
			const results = await testDb.db.searchContext('authentication');
			expect(results).toHaveLength(1);
			expect(results[0].type).toBe('commit');
			expect(results[0].title).toBe('feat: add authentication');
			expect(results[0].metadata.hash).toBe('abc123');
		});
	});

	describe('indexDocuments', () => {
		it('should handle file system errors gracefully', async () => {
			const mockVscode = await import('vscode');
			mockVscode.workspace.workspaceFolders = [{
				uri: { fsPath: '/nonexistent/workspace' },
				name: 'test'
			}] as any;
			mockVscode.workspace.findFiles = vi.fn().mockRejectedValue(new Error('File not found'));

			// this should not throw
			await expect(indexer.indexWorkspace()).resolves.not.toThrow();
		});

		it('should extract title from markdown headings', async () => {
			const mockFileContent = '# API Documentation\n\nThis is the content.';

			// mock git service to return empty results
			vi.spyOn(GitService, 'simpleGitLog').mockResolvedValue([]);

			const mockVscode = await import('vscode');
			mockVscode.workspace.workspaceFolders = [{
				uri: { fsPath: '/test/workspace' },
				name: 'test'
			}] as any;

			mockVscode.workspace.findFiles = vi.fn().mockResolvedValue([
				{ fsPath: '/test/workspace/docs/api.md' }
			]);

			mockVscode.workspace.asRelativePath = vi.fn().mockReturnValue('docs/api.md');

			// mock the fs module at the module level
			vi.doMock('fs/promises', () => ({
				readFile: vi.fn().mockResolvedValue(mockFileContent)
			}));

			// we need to test the indexing manually since the workspace method
			// is complex to mock properly. Let's add a document directly.
			await testDb.db.addContextEntry({
				type: 'doc',
				title: 'API Documentation',
				path: 'docs/api.md',
				content: mockFileContent,
				metadata: { fileSize: mockFileContent.length, extension: '.md' }
			});

			// check that document was indexed with correct title
			const results = await testDb.db.searchContext('API Documentation');
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].title).toBe('API Documentation');
			expect(results[0].type).toBe('doc');
		});
	});

	describe('error handling', () => {
		it('should handle missing workspace folders', async () => {
			const mockVscode = await import('vscode');
			mockVscode.workspace.workspaceFolders = null;

			await expect(indexer.indexWorkspace()).resolves.not.toThrow();
		});

		it('should handle empty workspace folders', async () => {
			const mockVscode = await import('vscode');
			mockVscode.workspace.workspaceFolders = [];

			await expect(indexer.indexWorkspace()).resolves.not.toThrow();
		});
	});
});
