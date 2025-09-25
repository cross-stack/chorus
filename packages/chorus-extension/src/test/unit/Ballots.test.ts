import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Ballots } from '../../services/Ballots';
import { LocalDB } from '../../storage/LocalDB';
import { QuietBallot } from '../../types';

describe('Ballots', () => {
  let ballots: Ballots;
  let db: LocalDB;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, '..', 'fixtures', 'test-db');
    if (!fs.existsSync(testDbPath)) {
      fs.mkdirSync(testDbPath, { recursive: true });
    }
    db = new LocalDB(testDbPath);
    ballots = new Ballots(db);
  });

  afterEach(() => {
    db.close();
    const dbFile = path.join(testDbPath, 'chorus.db');
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
  });

  describe('Quiet Ballot Creation', () => {
    it('should create a valid quiet ballot', () => {
      const result = ballots.createQuietBallot(
        'pr-123',
        'approve',
        4,
        'Code looks good, tests pass, design is well thought out'
      );

      expect(result.success).toBe(true);
      expect(result.ballot.prId).toBe('pr-123');
      expect(result.ballot.decision).toBe('approve');
      expect(result.ballot.confidence).toBe(4);
      expect(result.ballot.revealed).toBe(false);
      expect(result.ballot.authorId).toMatch(/^anon-/);
      expect(result.message).toContain('First-pass review submitted successfully');
    });

    it('should reject ballot with missing fields', () => {
      const result = ballots.createQuietBallot('pr-123', 'approve', 4, '');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Missing required fields');
    });

    it('should reject ballot with invalid confidence level', () => {
      const result = ballots.createQuietBallot(
        'pr-123',
        'approve',
        6 as any, // Invalid confidence level
        'This is a good rationale'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Confidence must be between 1 and 5');
    });

    it('should reject ballot with short rationale', () => {
      const result = ballots.createQuietBallot('pr-123', 'approve', 4, 'Too short');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Rationale must be at least 10 characters long');
    });

    it('should generate unique ballot IDs', () => {
      const result1 = ballots.createQuietBallot('pr-1', 'approve', 4, 'Good code quality');
      const result2 = ballots.createQuietBallot('pr-2', 'approve', 4, 'Another good review');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.ballot.id).not.toBe(result2.ballot.id);
    });
  });

  describe('Ballot Validation', () => {
    it('should validate correct ballot input', () => {
      const validation = ballots.validateBallot(
        'approve',
        4,
        'This is a well-reasoned rationale with enough detail'
      );

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid decision', () => {
      const validation = ballots.validateBallot(
        'invalid-decision',
        4,
        'This is a good rationale'
      );

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Decision must be approve, reject, or needs-work');
    });

    it('should reject invalid confidence levels', () => {
      const validation1 = ballots.validateBallot('approve', 0, 'Good rationale');
      const validation2 = ballots.validateBallot('approve', 6, 'Good rationale');

      expect(validation1.isValid).toBe(false);
      expect(validation2.isValid).toBe(false);
      expect(validation1.errors).toContain('Confidence must be between 1 and 5');
      expect(validation2.errors).toContain('Confidence must be between 1 and 5');
    });

    it('should reject short rationale', () => {
      const validation = ballots.validateBallot('approve', 4, 'Short');

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Rationale must be at least 10 characters long');
    });

    it('should warn about biased language', () => {
      const validation = ballots.validateBallot(
        'approve',
        4,
        'This is obviously a stupid implementation that is clearly wrong'
      );

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Consider using more objective language in your rationale');
    });

    it('should accept all valid decision types', () => {
      const decisions = ['approve', 'reject', 'needs-work'];

      for (const decision of decisions) {
        const validation = ballots.validateBallot(decision, 3, 'Valid rationale with enough content');
        expect(validation.isValid).toBe(true);
      }
    });
  });

  describe('Ballot Retrieval and Management', () => {
    beforeEach(() => {
      ballots.clearCurrentBallot();
    });

    it('should retrieve ballot by PR ID', () => {
      const result = ballots.createQuietBallot('pr-456', 'needs-work', 3, 'Needs improvement');

      expect(result.success).toBe(true);

      const retrieved = ballots.getBallot('pr-456');
      expect(retrieved).toBeDefined();
      expect(retrieved?.prId).toBe('pr-456');
      expect(retrieved?.decision).toBe('needs-work');
    });

    it('should return undefined for non-existent ballot', () => {
      const ballot = ballots.getBallot('non-existent-pr');
      expect(ballot).toBeUndefined();
    });

    it('should track current ballot', () => {
      expect(ballots.getCurrentBallot()).toBeUndefined();

      const result = ballots.createQuietBallot('pr-789', 'approve', 5, 'Excellent work');
      expect(result.success).toBe(true);

      const current = ballots.getCurrentBallot();
      expect(current).toBeDefined();
      expect(current?.prId).toBe('pr-789');
    });

    it('should clear current ballot', () => {
      ballots.createQuietBallot('pr-clear', 'approve', 4, 'Test ballot for clearing');
      expect(ballots.getCurrentBallot()).toBeDefined();

      ballots.clearCurrentBallot();
      expect(ballots.getCurrentBallot()).toBeUndefined();
    });
  });

  describe('First-Pass Review Status', () => {
    it('should identify active first-pass review', () => {
      const result = ballots.createQuietBallot('pr-active', 'approve', 4, 'First pass review');
      expect(result.success).toBe(true);

      expect(ballots.isFirstPassActive('pr-active')).toBe(true);
    });

    it('should identify inactive first-pass review after reveal', () => {
      const result = ballots.createQuietBallot('pr-revealed', 'approve', 4, 'Review to be revealed');
      expect(result.success).toBe(true);

      expect(ballots.isFirstPassActive('pr-revealed')).toBe(true);

      const revealResult = ballots.revealBallot(result.ballot.id);
      expect(revealResult.success).toBe(true);

      expect(ballots.isFirstPassActive('pr-revealed')).toBe(false);
    });

    it('should return false for non-existent PR', () => {
      expect(ballots.isFirstPassActive('non-existent')).toBe(false);
    });
  });

  describe('Ballot Revelation', () => {
    it('should reveal a ballot successfully', () => {
      const result = ballots.createQuietBallot('pr-reveal', 'reject', 2, 'Significant issues found');
      expect(result.success).toBe(true);

      const revealResult = ballots.revealBallot(result.ballot.id);

      expect(revealResult.success).toBe(true);
      expect(revealResult.ballot.revealed).toBe(true);
      expect(revealResult.message).toContain('Ballot revealed successfully');

      // Verify the ballot is updated in current ballot
      const current = ballots.getCurrentBallot();
      expect(current?.revealed).toBe(true);
    });

    it('should handle reveal of non-existent ballot', () => {
      const result = ballots.revealBallot('non-existent-ballot');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Ballot not found');
    });
  });

  describe('Ballot Statistics', () => {
    it('should return zero stats when no ballot exists', () => {
      const stats = ballots.getBallotStats();

      expect(stats.totalBallots).toBe(0);
      expect(stats.averageConfidence).toBe(0);
      expect(stats.decisionDistribution).toEqual({});
    });

    it('should return stats for current ballot', () => {
      ballots.createQuietBallot('pr-stats', 'approve', 4, 'Good implementation');

      const stats = ballots.getBallotStats();

      expect(stats.totalBallots).toBe(1);
      expect(stats.averageConfidence).toBe(4);
      expect(stats.decisionDistribution).toEqual({ approve: 1 });
    });
  });

  describe('Ballot Export', () => {
    it('should export unrevealed ballot with privacy protection', () => {
      const result = ballots.createQuietBallot(
        'pr-export',
        'needs-work',
        3,
        'Confidential feedback about the implementation'
      );
      expect(result.success).toBe(true);

      const exported = ballots.exportBallot(result.ballot.id);

      expect(exported).toBeDefined();
      expect(exported?.decision).toBe('needs-work');
      expect(exported?.confidence).toBe(3);
      expect(exported?.revealed).toBe(false);
      expect(exported?.rationale).toBe('[Hidden until reveal]');
      expect(exported?.authorId).toBe('[Anonymous]');
    });

    it('should export revealed ballot with full information', () => {
      const result = ballots.createQuietBallot('pr-export-revealed', 'approve', 5, 'Excellent work');
      expect(result.success).toBe(true);

      const revealResult = ballots.revealBallot(result.ballot.id);
      expect(revealResult.success).toBe(true);

      const exported = ballots.exportBallot(result.ballot.id);

      expect(exported?.revealed).toBe(true);
      expect(exported?.rationale).toBe('Excellent work');
      expect(exported?.authorId).toMatch(/^anon-/);
    });

    it('should return null for non-existent ballot', () => {
      const exported = ballots.exportBallot('non-existent');
      expect(exported).toBeNull();
    });
  });
});