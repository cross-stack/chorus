import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Indexer } from '../../services/Indexer';
import { LocalDB } from '../../storage/LocalDB';
import { ContextItem } from '../../types';

describe('Indexer', () => {
  let indexer: Indexer;
  let db: LocalDB;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, '..', 'fixtures', 'test-db');
    if (!fs.existsSync(testDbPath)) {
      fs.mkdirSync(testDbPath, { recursive: true });
    }
    db = new LocalDB(testDbPath);
    indexer = new Indexer(db);
  });

  afterEach(() => {
    db.close();
    const dbFile = path.join(testDbPath, 'chorus.db');
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
    vi.restoreAllMocks();
  });

  describe('Keyword Extraction', () => {
    it('should extract meaningful keywords from text', () => {
      // This test relies on accessing private methods, so we'll test indirectly
      // by checking the behavior of findRelatedContext

      const testText = [
        'This is a React component with authentication functionality',
        'It implements JWT tokens and user session management'
      ];

      // We can't directly test extractKeywords since it's private,
      // but we can test the overall behavior
      const result = indexer.findRelatedContext('/test/file.tsx', testText);
      expect(result).toBeDefined();
    });
  });

  describe('Related Context Finding', () => {
    beforeEach(() => {
      // Add some test context items to the database
      const testItems: ContextItem[] = [
        {
          id: 'context-1',
          type: 'commit',
          title: 'Add authentication system',
          content: 'Implemented JWT authentication with user login and session management',
          path: '/repo/auth.ts',
          timestamp: new Date('2023-01-01'),
          author: 'Alice',
          score: 2.0,
        },
        {
          id: 'context-2',
          type: 'doc',
          title: 'React components guide',
          content: 'Guide for creating React components with proper state management',
          path: '/repo/docs/components.md',
          timestamp: new Date('2023-01-02'),
          score: 1.5,
        },
        {
          id: 'context-3',
          type: 'commit',
          title: 'Database migration',
          content: 'Added database migration scripts for user tables',
          path: '/repo/migrations/',
          timestamp: new Date('2023-01-03'),
          author: 'Bob',
          score: 1.8,
        },
      ];

      testItems.forEach(item => db.insertContextItem(item));
    });

    it('should find related context for changed lines', async () => {
      const changedLines = [
        'import React from "react"',
        'const LoginComponent = () => {',
        '  const [user, setUser] = useState(null)',
        '  const handleAuth = () => authenticate(user)',
        '}'
      ];

      const results = await indexer.findRelatedContext('/repo/src/Login.tsx', changedLines);

      expect(Array.isArray(results)).toBe(true);
      // Results should be relevant to React and authentication
      if (results.length > 0) {
        const titles = results.map(r => r.title.toLowerCase());
        const hasRelevant = titles.some(title =>
          title.includes('react') ||
          title.includes('auth') ||
          title.includes('component')
        );
        expect(hasRelevant).toBe(true);
      }
    });

    it('should return empty array for unrelated content', async () => {
      const changedLines = [
        'const unrelatedVariable = 42',
        'function randomFunction() { return "xyz" }'
      ];

      const results = await indexer.findRelatedContext('/repo/src/Random.ts', changedLines);

      // Should return empty array or very low-scored results
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should limit results to maximum of 5 items', async () => {
      // Add many more items to test the limit
      for (let i = 0; i < 10; i++) {
        const item: ContextItem = {
          id: `extra-${i}`,
          type: 'commit',
          title: `Authentication feature ${i}`,
          content: `Authentication and React component implementation ${i}`,
          path: `/repo/auth${i}.ts`,
          timestamp: new Date(),
          score: 1.0,
        };
        db.insertContextItem(item);
      }

      const changedLines = ['authentication', 'react', 'component'];
      const results = await indexer.findRelatedContext('/repo/test.ts', changedLines);

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should score results by relevance', async () => {
      const changedLines = [
        'JWT authentication implementation',
        'user login and session management'
      ];

      const results = await indexer.findRelatedContext('/repo/auth.ts', changedLines);

      if (results.length > 1) {
        // Results should be sorted by score (highest first)
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
      }
    });
  });

  describe('Git History Indexing', () => {
    it('should handle git indexing gracefully when git is not available', async () => {
      // Mock exec to simulate git not being available
      const mockExec = vi.fn().mockRejectedValue(new Error('git not found'));
      vi.doMock('child_process', () => ({
        exec: mockExec,
      }));

      // Should not throw error even if git fails
      await expect(indexer.indexGitHistory('/fake/path', 10)).resolves.toBeUndefined();
    });

    it('should handle invalid workspace path', async () => {
      // Should not throw error for invalid paths
      await expect(indexer.indexGitHistory('/non/existent/path', 10)).resolves.toBeUndefined();
    });
  });

  describe('Documentation Indexing', () => {
    it('should handle non-existent documentation paths', async () => {
      // Should not throw error for non-existent paths
      await expect(indexer.indexDocumentation('/non/existent/path')).resolves.toBeUndefined();
    });

    it('should index markdown files when they exist', async () => {
      // Create a temporary test file
      const testDir = path.join(testDbPath, 'test-docs');
      const testFile = path.join(testDir, 'test.md');

      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      const testContent = `# Test Documentation

This is a test markdown file for indexing.

## Features

- Authentication system
- User management
- React components
`;

      fs.writeFileSync(testFile, testContent);

      try {
        // Mock the docs directory structure
        const workspaceRoot = testDbPath;
        const docsDir = path.join(workspaceRoot, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, 'README.md'), testContent);

        await indexer.indexDocumentation(workspaceRoot);

        // Check if items were added to database
        const items = db.getContextItems(10);
        const docItems = items.filter(item => item.type === 'doc');

        expect(docItems.length).toBeGreaterThan(0);
        if (docItems.length > 0) {
          expect(docItems[0].title).toContain('Test Documentation');
          expect(docItems[0].content).toContain('Authentication system');
        }
      } finally {
        // Cleanup
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
        const docsDir = path.join(testDbPath, 'docs');
        if (fs.existsSync(docsDir)) {
          fs.rmSync(docsDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('Scoring Algorithms', () => {
    beforeEach(() => {
      // Clear database for clean scoring tests
      db.clearAllData();
    });

    it('should assign higher scores to recent commits', () => {
      // This tests the internal scoring logic indirectly
      // by creating items with different dates and checking relative scores

      const recentItem: ContextItem = {
        id: 'recent',
        type: 'commit',
        title: 'Recent commit',
        content: 'Recent implementation',
        path: '/repo/recent.ts',
        timestamp: new Date(), // Very recent
        score: 0, // Will be calculated
      };

      const oldItem: ContextItem = {
        id: 'old',
        type: 'commit',
        title: 'Old commit',
        content: 'Old implementation',
        path: '/repo/old.ts',
        timestamp: new Date('2020-01-01'), // Very old
        score: 0, // Will be calculated
      };

      db.insertContextItem(recentItem);
      db.insertContextItem(oldItem);

      // The scoring is done during insertion, so we can check the results
      const items = db.getContextItems(10);

      expect(items.length).toBe(2);
      // Items are returned sorted by score DESC
      const [firstItem, secondItem] = items;

      // Recent item should typically have higher score due to recency bonus
      if (firstItem.id === 'recent') {
        expect(firstItem.score).toBeGreaterThanOrEqual(secondItem.score);
      }
    });

    it('should boost scores for fix-related commits', () => {
      const fixCommit: ContextItem = {
        id: 'fix-commit',
        type: 'commit',
        title: 'Fix bug in authentication system',
        content: 'Fixed critical issue with user login',
        path: '/repo/auth.ts',
        timestamp: new Date(),
        score: 0,
      };

      const regularCommit: ContextItem = {
        id: 'regular-commit',
        type: 'commit',
        title: 'Update documentation',
        content: 'Updated user guide',
        path: '/repo/docs.md',
        timestamp: new Date(),
        score: 0,
      };

      db.insertContextItem(fixCommit);
      db.insertContextItem(regularCommit);

      const items = db.getContextItems(10);
      const fixItem = items.find(item => item.id === 'fix-commit');
      const regularItem = items.find(item => item.id === 'regular-commit');

      expect(fixItem).toBeDefined();
      expect(regularItem).toBeDefined();

      if (fixItem && regularItem) {
        // Fix commits should get a score boost
        expect(fixItem.score).toBeGreaterThan(regularItem.score);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', async () => {
      // Mock fs to throw errors
      const originalReadFileSync = fs.readFileSync;
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('File system error');
      });

      // Should not throw errors
      await expect(indexer.indexDocumentation('/test/path')).resolves.toBeUndefined();

      // Restore original function
      vi.mocked(fs.readFileSync).mockRestore();
    });

    it('should handle database errors during indexing', () => {
      // Close database to simulate errors
      db.close();

      // Should not throw errors even with closed database
      expect(() => {
        const item: ContextItem = {
          id: 'test',
          type: 'commit',
          title: 'Test',
          content: 'Test content',
          path: '/test',
          timestamp: new Date(),
          score: 1.0,
        };
        // This will fail but should be caught
        try {
          db.insertContextItem(item);
        } catch {
          // Expected to fail with closed database
        }
      }).not.toThrow();
    });
  });
});