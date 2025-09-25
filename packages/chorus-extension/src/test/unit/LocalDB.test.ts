import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { LocalDB } from '../../storage/LocalDB';
import { ContextItem, EvidenceItem, QuietBallot } from '../../types';

describe('LocalDB', () => {
  let db: LocalDB;
  let testDbPath: string;

  beforeEach(() => {
    // Create temporary directory for test database
    testDbPath = path.join(__dirname, '..', 'fixtures', 'test-db');
    if (!fs.existsSync(testDbPath)) {
      fs.mkdirSync(testDbPath, { recursive: true });
    }
    db = new LocalDB(testDbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up test database
    const dbFile = path.join(testDbPath, 'chorus.db');
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
  });

  describe('Context Items', () => {
    const mockContextItem: ContextItem = {
      id: 'test-commit-123',
      type: 'commit',
      title: 'Add new feature',
      content: 'This commit adds a new feature for better user experience',
      path: '/repo/src/feature.ts',
      timestamp: new Date('2023-01-01'),
      author: 'Test Author',
      score: 1.5,
    };

    it('should insert and retrieve context items', () => {
      db.insertContextItem(mockContextItem);

      const items = db.getContextItems(10);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: mockContextItem.id,
        type: mockContextItem.type,
        title: mockContextItem.title,
        content: mockContextItem.content,
      });
    });

    it('should search context items by content', () => {
      const item1: ContextItem = { ...mockContextItem, id: 'item1', title: 'Feature A', content: 'React component' };
      const item2: ContextItem = { ...mockContextItem, id: 'item2', title: 'Feature B', content: 'Vue component' };
      const item3: ContextItem = { ...mockContextItem, id: 'item3', title: 'Feature C', content: 'Angular service' };

      db.insertContextItem(item1);
      db.insertContextItem(item2);
      db.insertContextItem(item3);

      const results = db.searchContextItems('component', 10);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.id)).toEqual(expect.arrayContaining(['item1', 'item2']));
    });

    it('should handle duplicate insertions with replace', () => {
      db.insertContextItem(mockContextItem);

      const updatedItem = { ...mockContextItem, title: 'Updated title' };
      db.insertContextItem(updatedItem);

      const items = db.getContextItems(10);
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Updated title');
    });

    it('should order items by score and timestamp', () => {
      const item1: ContextItem = { ...mockContextItem, id: 'item1', score: 1.0, timestamp: new Date('2023-01-01') };
      const item2: ContextItem = { ...mockContextItem, id: 'item2', score: 2.0, timestamp: new Date('2023-01-02') };
      const item3: ContextItem = { ...mockContextItem, id: 'item3', score: 1.5, timestamp: new Date('2023-01-03') };

      db.insertContextItem(item1);
      db.insertContextItem(item2);
      db.insertContextItem(item3);

      const items = db.getContextItems(10);
      expect(items.map(i => i.id)).toEqual(['item2', 'item3', 'item1']);
    });
  });

  describe('Evidence Items', () => {
    const mockEvidenceItem: EvidenceItem = {
      id: 'test-evidence-1',
      type: 'test',
      title: 'Unit test for feature',
      content: 'describe("feature", () => { it("should work", () => {}); });',
      status: 'present',
      filePath: '/repo/src/feature.test.ts',
      lineNumber: 10,
    };

    it('should insert and retrieve evidence items', () => {
      db.insertEvidenceItem(mockEvidenceItem);

      const items = db.getEvidenceItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: mockEvidenceItem.id,
        type: mockEvidenceItem.type,
        title: mockEvidenceItem.title,
        status: mockEvidenceItem.status,
      });
    });

    it('should handle evidence items without file path or line number', () => {
      const evidenceWithoutLocation: EvidenceItem = {
        id: 'test-evidence-2',
        type: 'spec',
        title: 'Design specification',
        content: 'This is the spec content',
        status: 'present',
      };

      db.insertEvidenceItem(evidenceWithoutLocation);

      const items = db.getEvidenceItems();
      expect(items).toHaveLength(1);
      expect(items[0].filePath).toBeUndefined();
      expect(items[0].lineNumber).toBeUndefined();
    });
  });

  describe('Quiet Ballots', () => {
    const mockBallot: QuietBallot = {
      id: 'ballot-123',
      prId: 'pr-456',
      decision: 'approve',
      confidence: 4,
      rationale: 'Code looks good, tests pass, design is solid',
      timestamp: new Date('2023-01-01'),
      revealed: false,
      authorId: 'anon-12345',
    };

    it('should insert and retrieve quiet ballots', () => {
      db.insertQuietBallot(mockBallot);

      const ballot = db.getQuietBallot(mockBallot.prId);
      expect(ballot).toMatchObject({
        id: mockBallot.id,
        prId: mockBallot.prId,
        decision: mockBallot.decision,
        confidence: mockBallot.confidence,
        rationale: mockBallot.rationale,
        revealed: false,
      });
    });

    it('should update ballot reveal status', () => {
      db.insertQuietBallot(mockBallot);

      db.updateBallotRevealStatus(mockBallot.id, true);

      const ballot = db.getQuietBallot(mockBallot.prId);
      expect(ballot?.revealed).toBe(true);
    });

    it('should return most recent ballot for PR', () => {
      const ballot1: QuietBallot = { ...mockBallot, id: 'ballot-1', timestamp: new Date('2023-01-01') };
      const ballot2: QuietBallot = { ...mockBallot, id: 'ballot-2', timestamp: new Date('2023-01-02') };

      db.insertQuietBallot(ballot1);
      db.insertQuietBallot(ballot2);

      const ballot = db.getQuietBallot(mockBallot.prId);
      expect(ballot?.id).toBe('ballot-2');
    });

    it('should return undefined for non-existent ballot', () => {
      const ballot = db.getQuietBallot('non-existent-pr');
      expect(ballot).toBeUndefined();
    });
  });

  describe('Database Operations', () => {
    it('should clear all data', () => {
      const contextItem: ContextItem = {
        id: 'test-1',
        type: 'commit',
        title: 'Test',
        content: 'Test content',
        path: '/test',
        timestamp: new Date(),
        score: 1.0,
      };

      const evidenceItem: EvidenceItem = {
        id: 'evidence-1',
        type: 'test',
        title: 'Test evidence',
        content: 'Test content',
        status: 'present',
      };

      const ballot: QuietBallot = {
        id: 'ballot-1',
        prId: 'pr-1',
        decision: 'approve',
        confidence: 3,
        rationale: 'Test rationale',
        timestamp: new Date(),
        revealed: false,
      };

      db.insertContextItem(contextItem);
      db.insertEvidenceItem(evidenceItem);
      db.insertQuietBallot(ballot);

      expect(db.getContextItems(10)).toHaveLength(1);
      expect(db.getEvidenceItems()).toHaveLength(1);
      expect(db.getQuietBallot('pr-1')).toBeDefined();

      db.clearAllData();

      expect(db.getContextItems(10)).toHaveLength(0);
      expect(db.getEvidenceItems()).toHaveLength(0);
      expect(db.getQuietBallot('pr-1')).toBeUndefined();
    });
  });
});