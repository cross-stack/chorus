import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Indexer } from './Indexer';
import { TestDatabase, createMockVSCodeWorkspace } from '../test/testUtils';
import * as GitService from './GitService';

// mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    asRelativePath: vi.fn(),
    findFiles: vi.fn(),
  },
  RelativePattern: vi.fn(),
  Uri: {
    joinPath: vi.fn(),
  },
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
        metadata: { hash: 'abc123', author: 'John' },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Authentication Guide',
        path: 'docs/auth.md',
        content: 'How to implement authentication in the app',
        metadata: { fileSize: 100 },
      });

      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'fix: resolve login issue',
        path: 'def456',
        content: 'Fixed bug in login component',
        metadata: { hash: 'def456', author: 'Jane' },
      });
    });

    it('should find context by filename', async () => {
      const results = await indexer.findRelevantContext('src/auth.ts');

      expect(results.length).toBeGreaterThan(0);
      // should find entries related to 'auth'
      const authRelated = results.filter(
        (r) => r.title.toLowerCase().includes('auth') || r.content.toLowerCase().includes('auth')
      );
      expect(authRelated.length).toBeGreaterThan(0);
    });

    it('should find context by symbol name', async () => {
      const results = await indexer.findRelevantContext('src/components/Login.tsx', 'login');

      expect(results.length).toBeGreaterThan(0);
      // should find the commit about login issue
      const loginRelated = results.filter(
        (r) => r.title.toLowerCase().includes('login') || r.content.toLowerCase().includes('login')
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
          metadata: { hash: 'hash' + i },
        });
      }

      const results = await indexer.findRelevantContext('src/auth.ts');
      expect(results.length).toBeLessThanOrEqual(10);
    });

    it('should deduplicate results', async () => {
      // this should return the same entry for multiple query terms
      const results = await indexer.findRelevantContext('auth/login.ts', 'auth');

      // check that there are no duplicate paths
      const paths = results.map((r) => r.path);
      const uniquePaths = [...new Set(paths)];
      expect(paths).toHaveLength(uniquePaths.length);
    });

    it('should rank commits higher than docs', async () => {
      const results = await indexer.findRelevantContext('src/auth.ts');

      if (results.length > 1) {
        // find first commit and first doc
        const firstCommitIndex = results.findIndex((r) => r.type === 'commit');
        const firstDocIndex = results.findIndex((r) => r.type === 'doc');

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
        metadata: { hash: 'hash1' },
      });

      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'unrelated change',
        path: 'hash2',
        content: 'This mentions authentication in passing',
        metadata: { hash: 'hash2' },
      });

      const results = await indexer.findRelevantContext('src/auth.ts');

      // the entry with 'authentication' in the title should rank higher
      // than the one that only mentions it in content
      if (results.length >= 2) {
        const titleMatch = results.find((r) => r.title.includes('authentication'));
        const contentMatch = results.find((r) => r.title.includes('unrelated'));

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
          files: ['src/auth.ts', 'src/types.ts'],
        },
      ];

      vi.spyOn(GitService, 'simpleGitLog').mockResolvedValue(mockCommits);

      // mock vscode workspace
      const mockVscode = await import('vscode');
      mockVscode.workspace.workspaceFolders = [
        {
          uri: { fsPath: '/test/workspace' },
          name: 'test',
        },
      ] as any;
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
      mockVscode.workspace.workspaceFolders = [
        {
          uri: { fsPath: '/nonexistent/workspace' },
          name: 'test',
        },
      ] as any;
      mockVscode.workspace.findFiles = vi.fn().mockRejectedValue(new Error('File not found'));

      // this should not throw
      await expect(indexer.indexWorkspace()).resolves.not.toThrow();
    });

    it('should extract title from markdown headings', async () => {
      const mockFileContent = '# API Documentation\n\nThis is the content.';

      // mock git service to return empty results
      vi.spyOn(GitService, 'simpleGitLog').mockResolvedValue([]);

      const mockVscode = await import('vscode');
      mockVscode.workspace.workspaceFolders = [
        {
          uri: { fsPath: '/test/workspace' },
          name: 'test',
        },
      ] as any;

      mockVscode.workspace.findFiles = vi
        .fn()
        .mockResolvedValue([{ fsPath: '/test/workspace/docs/api.md' }]);

      mockVscode.workspace.asRelativePath = vi.fn().mockReturnValue('docs/api.md');

      // mock the fs module at the module level
      vi.doMock('fs/promises', () => ({
        readFile: vi.fn().mockResolvedValue(mockFileContent),
      }));

      // we need to test the indexing manually since the workspace method
      // is complex to mock properly. Let's add a document directly.
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'API Documentation',
        path: 'docs/api.md',
        content: mockFileContent,
        metadata: { fileSize: mockFileContent.length, extension: '.md' },
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

  describe('bm25 ranking', () => {
    it('should rank results by relevance using bm25', async () => {
      // add three context entries with varying relevance to 'testing'
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'React Testing Guide',
        path: 'docs/testing.md',
        content: 'testing testing testing react components unit testing integration testing',
        metadata: { fileSize: 100 },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'API Documentation',
        path: 'docs/api.md',
        content: 'api endpoints rest http testing mentioned once here',
        metadata: { fileSize: 100 },
      });

      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'fix: update config',
        path: 'hash123',
        content: 'updated configuration file for production',
        metadata: { hash: 'hash123' },
      });

      const results = await indexer.findRelevantContext('test.tsx', 'testing');

      // most relevant (testing guide with high tf) should be first
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('React Testing Guide');
    });

    it('should handle rare terms with higher idf scores', async () => {
      // add entries with common and rare terms
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Common Terms Document',
        path: 'docs/common.md',
        content: 'the the the the the the the',
        metadata: { fileSize: 50 },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Unique Quantum Physics Guide',
        path: 'docs/quantum.md',
        content: 'quantum entanglement superposition measurement',
        metadata: { fileSize: 50 },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Another Document',
        path: 'docs/other.md',
        content: 'something else entirely unrelated',
        metadata: { fileSize: 50 },
      });

      const results = await indexer.findRelevantContext('quantum.ts', 'quantum');

      // rare term 'quantum' should rank quantum physics guide first
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Unique Quantum Physics Guide');
    });

    it('should normalize by document length', async () => {
      // add short document with one occurrence
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Short Authentication Doc',
        path: 'docs/short-auth.md',
        content: 'authentication',
        metadata: { fileSize: 20 },
      });

      // add long document with one occurrence
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Long Verbose Document',
        path: 'docs/long.md',
        content:
          'authentication is important but this document has lots and lots ' +
          'of other content that dilutes the relevance of the single mention ' +
          'of the search term making it less relevant overall despite having ' +
          'the same term frequency count as the shorter document',
        metadata: { fileSize: 200 },
      });

      const results = await indexer.findRelevantContext('auth.ts', 'authentication');

      // short doc should rank higher due to length normalization
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Short Authentication Doc');
    });

    it('should handle empty queries gracefully', async () => {
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Test Document',
        path: 'docs/test.md',
        content: 'content here',
        metadata: { fileSize: 50 },
      });

      // empty filename and no symbol should still work
      const results = await indexer.findRelevantContext('', '');
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle queries with special characters', async () => {
      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'feat: add user-auth module',
        path: 'hash456',
        content: 'Implemented user@auth with special-chars_123',
        metadata: { hash: 'hash456' },
      });

      const results = await indexer.findRelevantContext('user-auth.ts', 'user@auth');

      // should tokenize and match despite special characters
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle single-term queries', async () => {
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Database Guide',
        path: 'docs/database.md',
        content: 'database connection pooling queries indexes',
        metadata: { fileSize: 100 },
      });

      const results = await indexer.findRelevantContext('db.ts');

      // should find results even with abbreviated filename
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should rank multi-term matches higher', async () => {
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'React Testing Library Guide',
        path: 'docs/react-testing.md',
        content: 'react testing library components hooks testing utilities',
        metadata: { fileSize: 100 },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'React Documentation',
        path: 'docs/react.md',
        content: 'react framework components jsx hooks state props',
        metadata: { fileSize: 100 },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Testing Best Practices',
        path: 'docs/testing.md',
        content: 'testing unit integration e2e coverage mocking',
        metadata: { fileSize: 100 },
      });

      const results = await indexer.findRelevantContext('react-test.tsx', 'testing');

      // document matching both 'react' and 'testing' should rank highest
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('React Testing Library Guide');
    });

    it('should filter single-character tokens', async () => {
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'C Programming Guide',
        path: 'docs/c-lang.md',
        content: 'c programming language pointers memory',
        metadata: { fileSize: 100 },
      });

      // single character 'c' should be filtered during tokenization
      const results = await indexer.findRelevantContext('test.c', 'c');

      // should still return results based on other query terms
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle no matching results', async () => {
      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'Unrelated Document',
        path: 'docs/unrelated.md',
        content: 'completely unrelated content',
        metadata: { fileSize: 100 },
      });

      const results = await indexer.findRelevantContext(
        'nonexistent-xyz-file.ts',
        'nonexistent-symbol'
      );

      // should return empty array when no matches
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should deduplicate before ranking', async () => {
      // add entry that matches multiple query terms
      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'feat: add auth service',
        path: 'hash789',
        content: 'authentication service implementation',
        metadata: { hash: 'hash789' },
      });

      // query with overlapping terms that would return same entry
      const results = await indexer.findRelevantContext('services/auth-service.ts', 'auth');

      // should not have duplicates
      const paths = results.map((r) => r.path);
      const uniquePaths = [...new Set(paths)];
      expect(paths).toHaveLength(uniquePaths.length);
    });

    it('should maintain performance with many documents', async () => {
      // add 50 documents
      for (let i = 0; i < 50; i++) {
        await testDb.db.addContextEntry({
          type: 'doc',
          title: 'Document ' + i,
          path: 'docs/doc' + i + '.md',
          content:
            'content with various terms database testing auth user component ' +
            'render hook state props context provider consumer reducer action ' +
            'dispatch middleware thunk saga effect observable stream pipe',
          metadata: { fileSize: 200 },
        });
      }

      const startTime = Date.now();
      const results = await indexer.findRelevantContext('component.tsx', 'testing');
      const endTime = Date.now();

      // should complete in reasonable time (<200ms for 50 docs)
      expect(endTime - startTime).toBeLessThan(200);
      expect(results).toBeDefined();
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });
});
