import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Search } from '../../services/Search';
import { LocalDB } from '../../storage/LocalDB';
import { ContextItem, SearchQuery } from '../../types';

describe('Search', () => {
  let search: Search;
  let db: LocalDB;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, '..', 'fixtures', 'test-db');
    if (!fs.existsSync(testDbPath)) {
      fs.mkdirSync(testDbPath, { recursive: true });
    }
    db = new LocalDB(testDbPath);
    search = new Search(db);
  });

  afterEach(() => {
    db.close();
    const dbFile = path.join(testDbPath, 'chorus.db');
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
  });

  describe('Quick Search', () => {
    beforeEach(() => {
      // Add test context items
      const items: ContextItem[] = [
        {
          id: 'item1',
          type: 'commit',
          title: 'Add React component',
          content: 'Added new React component for user interface',
          path: '/repo/src/component.tsx',
          timestamp: new Date('2023-01-01'),
          author: 'Alice',
          score: 2.0,
        },
        {
          id: 'item2',
          type: 'doc',
          title: 'Vue.js documentation',
          content: 'Documentation for Vue.js implementation guide',
          path: '/repo/docs/vue.md',
          timestamp: new Date('2023-01-02'),
          score: 1.5,
        },
        {
          id: 'item3',
          type: 'commit',
          title: 'Fix bug in component',
          content: 'Fixed rendering issue in React component',
          path: '/repo/src/component.tsx',
          timestamp: new Date('2023-01-03'),
          author: 'Bob',
          score: 1.8,
        },
      ];

      items.forEach(item => db.insertContextItem(item));
    });

    it('should find items by title content', () => {
      const results = search.quickSearch('React');

      expect(results).toHaveLength(2);
      expect(results.map(r => r.id)).toEqual(expect.arrayContaining(['item1', 'item3']));
    });

    it('should find items by content text', () => {
      const results = search.quickSearch('Vue.js');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('item2');
    });

    it('should return empty array for empty query', () => {
      const results = search.quickSearch('');
      expect(results).toHaveLength(0);
    });

    it('should return empty array for non-matching query', () => {
      const results = search.quickSearch('NonExistentTerm');
      expect(results).toHaveLength(0);
    });

    it('should limit results correctly', () => {
      const results = search.quickSearch('component', 1);
      expect(results).toHaveLength(1);
    });
  });

  describe('BM25 Search', () => {
    beforeEach(() => {
      const items: ContextItem[] = [
        {
          id: 'bm25-1',
          type: 'commit',
          title: 'Authentication system',
          content: 'Implemented JWT authentication with refresh tokens and user session management',
          path: '/repo/auth.ts',
          timestamp: new Date('2023-01-01'),
          score: 1.0,
        },
        {
          id: 'bm25-2',
          type: 'doc',
          title: 'Authentication Guide',
          content: 'Guide for implementing authentication in the application using JWT tokens',
          path: '/repo/docs/auth.md',
          timestamp: new Date('2023-01-02'),
          score: 0.8,
        },
        {
          id: 'bm25-3',
          type: 'commit',
          title: 'User management',
          content: 'Added user registration and profile management features',
          path: '/repo/users.ts',
          timestamp: new Date('2023-01-03'),
          score: 1.2,
        },
      ];

      items.forEach(item => db.insertContextItem(item));
    });

    it('should perform BM25 search with proper scoring', () => {
      const query: SearchQuery = {
        terms: ['authentication', 'JWT'],
      };

      const results = search.searchContext(query);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedTerms).toContain('authentication');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should filter by context type', () => {
      const query: SearchQuery = {
        terms: ['authentication'],
        type: 'doc',
      };

      const results = search.searchContext(query);

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.item.type).toBe('doc');
      });
    });

    it('should filter by time range', () => {
      const query: SearchQuery = {
        terms: ['user'],
        timeRange: {
          start: new Date('2023-01-03'),
          end: new Date('2023-01-04'),
        },
      };

      const results = search.searchContext(query);

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.item.timestamp.getTime()).toBeGreaterThanOrEqual(
          new Date('2023-01-03').getTime()
        );
      });
    });

    it('should return results sorted by score', () => {
      const query: SearchQuery = {
        terms: ['authentication', 'system', 'JWT'],
      };

      const results = search.searchContext(query);

      if (results.length > 1) {
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
      }
    });
  });

  describe('Similar Item Search', () => {
    const referenceItem: ContextItem = {
      id: 'reference',
      type: 'commit',
      title: 'Database migration',
      content: 'Added database migration scripts for user table schema changes',
      path: '/repo/migrations/001_users.sql',
      timestamp: new Date('2023-01-01'),
      score: 1.5,
    };

    beforeEach(() => {
      const items: ContextItem[] = [
        referenceItem,
        {
          id: 'similar-1',
          type: 'commit',
          title: 'Database schema update',
          content: 'Updated database schema for better performance',
          path: '/repo/migrations/002_performance.sql',
          timestamp: new Date('2023-01-02'),
          score: 1.3,
        },
        {
          id: 'similar-2',
          type: 'doc',
          title: 'Migration guide',
          content: 'Guide for running database migrations safely in production',
          path: '/repo/docs/migrations.md',
          timestamp: new Date('2023-01-03'),
          score: 1.1,
        },
        {
          id: 'unrelated',
          type: 'commit',
          title: 'UI improvements',
          content: 'Improved user interface with better colors and spacing',
          path: '/repo/ui/styles.css',
          timestamp: new Date('2023-01-04'),
          score: 0.9,
        },
      ];

      items.forEach(item => db.insertContextItem(item));
    });

    it('should find similar items', () => {
      const similar = search.findSimilar(referenceItem, 5);

      expect(similar.length).toBeGreaterThan(0);
      expect(similar.map(s => s.id)).not.toContain(referenceItem.id);

      // Should find items with similar content
      const titles = similar.map(s => s.title);
      expect(titles.some(title => title.includes('Database') || title.includes('migration'))).toBe(true);
    });

    it('should exclude the reference item itself', () => {
      const similar = search.findSimilar(referenceItem, 10);

      expect(similar.map(s => s.id)).not.toContain(referenceItem.id);
    });

    it('should respect the limit parameter', () => {
      const similar = search.findSimilar(referenceItem, 2);
      expect(similar.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array for item with no similar content', () => {
      const uniqueItem: ContextItem = {
        id: 'unique',
        type: 'commit',
        title: 'Unique feature xyz',
        content: 'Implemented very unique feature xyz with special functionality',
        path: '/repo/unique.ts',
        timestamp: new Date(),
        score: 1.0,
      };

      // Don't add to database, so no similar items exist
      const similar = search.findSimilar(uniqueItem, 5);
      expect(similar).toHaveLength(0);
    });
  });

  describe('Advanced Search', () => {
    beforeEach(() => {
      const items: ContextItem[] = [
        {
          id: 'advanced-1',
          type: 'commit',
          title: 'Frontend refactoring',
          content: 'Refactored frontend components for better maintainability',
          path: '/repo/frontend/',
          timestamp: new Date('2023-01-01'),
          author: 'Alice',
          score: 2.5,
        },
        {
          id: 'advanced-2',
          type: 'doc',
          title: 'Backend API documentation',
          content: 'Documentation for backend API endpoints and authentication',
          path: '/repo/docs/backend.md',
          timestamp: new Date('2023-01-05'),
          author: 'Bob',
          score: 1.8,
        },
        {
          id: 'advanced-3',
          type: 'commit',
          title: 'Database optimization',
          content: 'Optimized database queries for better performance',
          path: '/repo/database/',
          timestamp: new Date('2023-01-10'),
          author: 'Alice',
          score: 1.2,
        },
      ];

      items.forEach(item => db.insertContextItem(item));
    });

    it('should search by text', () => {
      const results = search.advancedSearch({
        text: 'frontend',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('advanced-1');
    });

    it('should filter by type', () => {
      const results = search.advancedSearch({
        type: 'doc',
      });

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('doc');
    });

    it('should filter by author', () => {
      const results = search.advancedSearch({
        author: 'Alice',
      });

      expect(results).toHaveLength(2);
      results.forEach(item => {
        expect(item.author).toBe('Alice');
      });
    });

    it('should filter by date range', () => {
      const results = search.advancedSearch({
        dateFrom: new Date('2023-01-05'),
        dateTo: new Date('2023-01-15'),
      });

      expect(results).toHaveLength(2);
    });

    it('should filter by minimum score', () => {
      const results = search.advancedSearch({
        minScore: 2.0,
      });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThanOrEqual(2.0);
    });

    it('should combine multiple filters', () => {
      const results = search.advancedSearch({
        author: 'Alice',
        type: 'commit',
        minScore: 1.0,
      });

      expect(results).toHaveLength(2);
      results.forEach(item => {
        expect(item.author).toBe('Alice');
        expect(item.type).toBe('commit');
        expect(item.score).toBeGreaterThanOrEqual(1.0);
      });
    });

    it('should respect limit parameter', () => {
      const results = search.advancedSearch({
        limit: 1,
      });

      expect(results).toHaveLength(1);
    });
  });

  describe('Search Suggestions', () => {
    beforeEach(() => {
      const items: ContextItem[] = [
        {
          id: 'suggest-1',
          type: 'commit',
          title: 'Authentication implementation',
          content: 'Implemented authentication system with JWT tokens and user authentication',
          path: '/repo/auth.ts',
          timestamp: new Date(),
          score: 1.0,
        },
        {
          id: 'suggest-2',
          type: 'doc',
          title: 'Authorization guide',
          content: 'Guide for implementing authorization in the application',
          path: '/repo/docs/auth.md',
          timestamp: new Date(),
          score: 1.0,
        },
      ];

      items.forEach(item => db.insertContextItem(item));
    });

    it('should return suggestions for partial query', () => {
      const suggestions = search.getSuggestions('auth');

      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThanOrEqual(0);

      if (suggestions.length > 0) {
        suggestions.forEach(suggestion => {
          expect(suggestion).toMatch(/^auth/i);
        });
      }
    });

    it('should return empty array for very short query', () => {
      const suggestions = search.getSuggestions('a');
      expect(suggestions).toHaveLength(0);
    });

    it('should limit suggestions to 10 items', () => {
      const suggestions = search.getSuggestions('the');
      expect(suggestions.length).toBeLessThanOrEqual(10);
    });

    it('should return unique suggestions', () => {
      const suggestions = search.getSuggestions('auth');
      const uniqueSuggestions = [...new Set(suggestions)];
      expect(suggestions).toEqual(uniqueSuggestions);
    });
  });
});