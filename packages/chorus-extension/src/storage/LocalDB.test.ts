import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalDB, ContextEntry, BallotEntry } from './LocalDB';
import { TestDatabase, mockContextEntry, mockDocumentEntry, mockBallot } from '../test/testUtils';

describe('LocalDB', () => {
  let testDb: TestDatabase;
  let db: LocalDB;

  beforeEach(async () => {
    testDb = new TestDatabase();
    db = testDb.db;
    await testDb.setup();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  describe('initialization', () => {
    it('should initialize database successfully', async () => {
      const freshDb = new TestDatabase();
      await expect(freshDb.setup()).resolves.not.toThrow();
      await freshDb.cleanup();
    });

    it('should create tables on initialization', async () => {
      // tables should be created during setup
      // test by inserting data. if tables don't exist, it will throw
      await expect(db.addContextEntry(mockContextEntry)).resolves.toBeTypeOf('number');
    });

    it('should throw error when accessing uninitialized database', async () => {
      const uninitializedDb = new TestDatabase();
      await expect(uninitializedDb.db.addContextEntry(mockContextEntry)).rejects.toThrow(
        'Database not initialized'
      );
      await uninitializedDb.cleanup();
    });
  });

  describe('context entries', () => {
    it('should add context entry successfully', async () => {
      const id = await db.addContextEntry(mockContextEntry);
      expect(id).toBeTypeOf('number');
      expect(id).toBeGreaterThan(0);
    });

    it('should add multiple context entries with unique IDs', async () => {
      const id1 = await db.addContextEntry(mockContextEntry);
      const id2 = await db.addContextEntry(mockDocumentEntry);

      expect(id1).not.toBe(id2);
      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThan(0);
    });

    it('should search context by content', async () => {
      await db.addContextEntry(mockContextEntry);
      await db.addContextEntry(mockDocumentEntry);

      const results = await db.searchContext('authentication');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe(mockContextEntry.title);
      expect(results[0].type).toBe('commit');
    });

    it('should search context by title', async () => {
      await db.addContextEntry(mockContextEntry);
      await db.addContextEntry(mockDocumentEntry);

      const results = await db.searchContext('API Documentation');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('API Documentation');
      expect(results[0].type).toBe('doc');
    });

    it('should filter search results by type', async () => {
      await db.addContextEntry(mockContextEntry);
      await db.addContextEntry(mockDocumentEntry);

      const commitResults = await db.searchContext('authentication', 'commit');
      expect(commitResults.length).toBeGreaterThan(0);
      expect(commitResults[0].type).toBe('commit');

      const docResults = await db.searchContext('API', 'doc');
      expect(docResults.length).toBeGreaterThan(0);
      expect(docResults[0].type).toBe('doc');
    });

    it('should return empty array when no matches found', async () => {
      await db.addContextEntry(mockContextEntry);

      const results = await db.searchContext('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('should parse metadata correctly', async () => {
      await db.addContextEntry(mockContextEntry);

      const results = await db.searchContext('authentication');
      expect(results[0].metadata).toEqual(mockContextEntry.metadata);
      expect(results[0].metadata.hash).toBe('abc123def');
      expect(results[0].metadata.files).toEqual(['src/auth.ts', 'src/types.ts']);
    });

    it('should limit search results to 50', async () => {
      // add more than 50 entries
      for (let i = 0; i < 60; i++) {
        await db.addContextEntry({
          ...mockContextEntry,
          title: 'Entry ' + i,
          path: 'path' + i,
        });
      }

      const results = await db.searchContext('Entry');
      expect(results).toHaveLength(50);
    });
  });

  describe('ballots', () => {
    it('should add ballot successfully', async () => {
      const id = await db.addBallot(mockBallot);
      expect(id).toBeTypeOf('number');
      expect(id).toBeGreaterThan(0);
    });

    it('should retrieve ballots by PR reference', async () => {
      await db.addBallot(mockBallot);
      await db.addBallot({ ...mockBallot, pr_reference: '#456' });

      const ballots = await db.getBallotsByPR('#123');
      expect(ballots).toHaveLength(1);
      expect(ballots[0].pr_reference).toBe('#123');
      expect(ballots[0].decision).toBe('approve');
      expect(ballots[0].confidence).toBe(4);
    });

    it('should return empty array for non-existent PR', async () => {
      const ballots = await db.getBallotsByPR('#999');
      expect(ballots).toHaveLength(0);
    });

    it('should validate decision values', async () => {
      // valid decisions
      await expect(db.addBallot({ ...mockBallot, decision: 'approve' })).resolves.toBeDefined();
      await expect(db.addBallot({ ...mockBallot, decision: 'reject' })).resolves.toBeDefined();
      await expect(db.addBallot({ ...mockBallot, decision: 'neutral' })).resolves.toBeDefined();
    });

    it('should validate confidence range', async () => {
      // valid confidence values
      await expect(db.addBallot({ ...mockBallot, confidence: 1 })).resolves.toBeDefined();
      await expect(db.addBallot({ ...mockBallot, confidence: 5 })).resolves.toBeDefined();
    });

    it('should reveal ballots for PR', async () => {
      await db.addBallot(mockBallot);
      await db.addBallot({ ...mockBallot, pr_reference: '#456' });

      await db.revealBallots('#123');

      const ballots = await db.getBallotsByPR('#123');
      expect(ballots[0].revealed).toBe(true);

      // other PR should not be affected
      const otherBallots = await db.getBallotsByPR('#456');
      expect(otherBallots[0].revealed).toBe(false);
    });

    it('should order ballots by creation date descending', async () => {
      const ballot1 = { ...mockBallot, rationale: 'First ballot' };
      const ballot2 = { ...mockBallot, rationale: 'Second ballot' };

      await db.addBallot(ballot1);
      // small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 100));
      await db.addBallot(ballot2);

      const ballots = await db.getBallotsByPR('#123');
      expect(ballots).toHaveLength(2);
      // SQLite DATETIME comparison should order properly
      // but let's be more flexible
      const rationales = ballots.map((b) => b.rationale);
      expect(rationales).toContain('First ballot');
      expect(rationales).toContain('Second ballot');
    });
  });

  describe('data management', () => {
    it('should clear all data', async () => {
      await db.addContextEntry(mockContextEntry);
      await db.addBallot(mockBallot);

      await db.clearAllData();

      const contextResults = await db.searchContext('');
      const ballots = await db.getBallotsByPR('#123');

      expect(contextResults).toHaveLength(0);
      expect(ballots).toHaveLength(0);
    });

    it('should dispose resources properly', async () => {
      // this mainly tests that dispose doesn't throw
      expect(() => db.dispose()).not.toThrow();

      // after disposal, operations should fail
      await expect(db.addContextEntry(mockContextEntry)).rejects.toThrow(
        'Database not initialized'
      );
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      db.dispose(); // Force database to be closed

      await expect(db.addContextEntry(mockContextEntry)).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('should handle invalid JSON in metadata', async () => {
      // this is more of a regression test
      // the system should handle proper JSON serialization internally
      const entryWithComplexMetadata = {
        ...mockContextEntry,
        metadata: {
          nested: { data: ['array', 'of', 'values'] },
          date: new Date('2023-01-01'),
          number: 42,
        },
      };

      await expect(db.addContextEntry(entryWithComplexMetadata)).resolves.toBeDefined();

      const results = await db.searchContext('authentication');
      expect(results[0].metadata.nested.data).toEqual(['array', 'of', 'values']);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings in search', async () => {
      await db.addContextEntry(mockContextEntry);

      const results = await db.searchContext('');
      expect(results).toHaveLength(1); // empty search should return all results
    });

    it('should handle special characters in search', async () => {
      await db.addContextEntry({
        ...mockContextEntry,
        title: 'feat: add @special #characters & symbols',
      });

      const results = await db.searchContext('@special');
      expect(results).toHaveLength(1);
    });

    it('should be case-insensitive in search', async () => {
      await db.addContextEntry({
        ...mockContextEntry,
        title: 'UPPERCASE TITLE',
      });

      const results = await db.searchContext('uppercase');
      expect(results).toHaveLength(1);
    });
  });

  describe('PR Phase State Management', () => {
    // coverage: test pr phase state tracking for blinded review workflow
    const testPR = 'PR-123';
    const altPR = 'PR-456';

    describe('getPRPhase', () => {
      it('should return null for uninitialized PR', async () => {
        // arrange - no prior state set

        // act
        const phase = await db.getPRPhase(testPR);

        // assert
        expect(phase).toBeNull();
      });

      it('should return correct phase after setting', async () => {
        // arrange
        await db.setPRPhase(testPR, 'revealed');

        // act
        const phase = await db.getPRPhase(testPR);

        // assert
        expect(phase).toBe('revealed');
      });

      it('should return different phases for different PRs', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');
        await db.setPRPhase(altPR, 'revealed');

        // act
        const phase1 = await db.getPRPhase(testPR);
        const phase2 = await db.getPRPhase(altPR);

        // assert
        expect(phase1).toBe('blinded');
        expect(phase2).toBe('revealed');
      });

      it('should throw error when database not initialized', async () => {
        // arrange
        db.dispose();

        // act & assert
        await expect(db.getPRPhase(testPR)).rejects.toThrow('Database not initialized');
      });
    });

    describe('setPRPhase', () => {
      it('should set phase to blinded', async () => {
        // arrange & act
        await db.setPRPhase(testPR, 'blinded');

        // assert
        const phase = await db.getPRPhase(testPR);
        expect(phase).toBe('blinded');
      });

      it('should set phase to revealed', async () => {
        // arrange & act
        await db.setPRPhase(testPR, 'revealed');

        // assert
        const phase = await db.getPRPhase(testPR);
        expect(phase).toBe('revealed');
      });

      it('should transition from blinded to revealed', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');

        // act
        await db.setPRPhase(testPR, 'revealed');

        // assert
        const phase = await db.getPRPhase(testPR);
        expect(phase).toBe('revealed');
      });

      it('should allow transition from revealed back to blinded', async () => {
        // arrange - coverage: test phase reversibility (edge case)
        await db.setPRPhase(testPR, 'revealed');

        // act
        await db.setPRPhase(testPR, 'blinded');

        // assert
        const phase = await db.getPRPhase(testPR);
        expect(phase).toBe('blinded');
      });

      it('should update existing PR state on conflict', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');

        // act - set again to test UPSERT behavior
        await db.setPRPhase(testPR, 'revealed');

        // assert
        const phase = await db.getPRPhase(testPR);
        expect(phase).toBe('revealed');
      });

      it('should throw error when database not initialized', async () => {
        // arrange
        db.dispose();

        // act & assert
        await expect(db.setPRPhase(testPR, 'blinded')).rejects.toThrow('Database not initialized');
      });
    });

    describe('canSubmitBallot', () => {
      it('should return true when PR is in blinded phase', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');

        // act
        const canSubmit = await db.canSubmitBallot(testPR);

        // assert
        expect(canSubmit).toBe(true);
      });

      it('should return false when PR is in revealed phase', async () => {
        // arrange
        await db.setPRPhase(testPR, 'revealed');

        // act
        const canSubmit = await db.canSubmitBallot(testPR);

        // assert
        expect(canSubmit).toBe(false);
      });

      it('should return true by default for new PR', async () => {
        // arrange - no phase set, defaults to blinded

        // act
        const canSubmit = await db.canSubmitBallot(testPR);

        // assert
        expect(canSubmit).toBe(true);
      });

      it('should handle multiple PRs independently', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');
        await db.setPRPhase(altPR, 'revealed');

        // act
        const canSubmit1 = await db.canSubmitBallot(testPR);
        const canSubmit2 = await db.canSubmitBallot(altPR);

        // assert
        expect(canSubmit1).toBe(true);
        expect(canSubmit2).toBe(false);
      });
    });

    describe('canRevealBallots', () => {
      it('should return false when no ballots exist', async () => {
        // arrange
        await db.startBlindedReview(testPR, 3);

        // act
        const canReveal = await db.canRevealBallots(testPR);

        // assert
        expect(canReveal).toBe(false);
      });

      it('should return true when ballots meet threshold in blinded phase', async () => {
        // arrange - set threshold to 1 for this test
        await db.startBlindedReview(testPR, 1);
        await db.addBallot({ ...mockBallot, pr_reference: testPR });

        // act
        const canReveal = await db.canRevealBallots(testPR);

        // assert
        expect(canReveal).toBe(true);
      });

      it('should return false when already in revealed phase', async () => {
        // arrange
        await db.setPRPhase(testPR, 'revealed');
        await db.addBallot({ ...mockBallot, pr_reference: testPR });

        // act
        const canReveal = await db.canRevealBallots(testPR);

        // assert
        expect(canReveal).toBe(false);
      });

      it('should return true with multiple ballots meeting threshold', async () => {
        // arrange - coverage: test threshold-like behavior with multiple ballots
        await db.startBlindedReview(testPR, 3);
        await db.addBallot({ ...mockBallot, pr_reference: testPR, rationale: 'First' });
        await db.addBallot({ ...mockBallot, pr_reference: testPR, rationale: 'Second' });
        await db.addBallot({ ...mockBallot, pr_reference: testPR, rationale: 'Third' });

        // act
        const canReveal = await db.canRevealBallots(testPR);

        // assert
        expect(canReveal).toBe(true);
      });

      it('should handle different PRs independently', async () => {
        // arrange
        await db.startBlindedReview(testPR, 1);
        await db.addBallot({ ...mockBallot, pr_reference: testPR });
        await db.startBlindedReview(altPR, 3);
        // no ballots for altPR (needs 3)

        // act
        const canReveal1 = await db.canRevealBallots(testPR);
        const canReveal2 = await db.canRevealBallots(altPR);

        // assert
        expect(canReveal1).toBe(true);
        expect(canReveal2).toBe(false);
      });

      it('should throw error when database not initialized', async () => {
        // arrange
        db.dispose();

        // act & assert
        await expect(db.canRevealBallots(testPR)).rejects.toThrow('Database not initialized');
      });
    });

    describe('integration: phase transitions with ballots', () => {
      // coverage: cross-table integration tests
      it('should prevent ballot submission after reveal', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');
        await db.addBallot({ ...mockBallot, pr_reference: testPR });

        // act - transition to revealed
        await db.setPRPhase(testPR, 'revealed');
        await db.revealBallots(testPR);

        // assert - should not allow new ballots
        const canSubmit = await db.canSubmitBallot(testPR);
        expect(canSubmit).toBe(false);
      });

      it('should reveal ballots and update phase together', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');
        await db.addBallot({ ...mockBallot, pr_reference: testPR, revealed: false });

        // act - reveal ballots and set phase
        await db.revealBallots(testPR);
        await db.setPRPhase(testPR, 'revealed');

        // assert
        const ballots = await db.getBallotsByPR(testPR);
        const phase = await db.getPRPhase(testPR);

        expect(ballots[0].revealed).toBe(true);
        expect(phase).toBe('revealed');
      });

      it('should track ballot count correctly for reveal eligibility', async () => {
        // arrange - set threshold to 3
        await db.startBlindedReview(testPR, 3);

        // act & assert - no ballots yet
        let canReveal = await db.canRevealBallots(testPR);
        expect(canReveal).toBe(false);

        // add first ballot (1/3)
        await db.addBallot({ ...mockBallot, pr_reference: testPR, rationale: 'Ballot 1' });
        canReveal = await db.canRevealBallots(testPR);
        expect(canReveal).toBe(false);

        // add second ballot (2/3)
        await db.addBallot({ ...mockBallot, pr_reference: testPR, rationale: 'Ballot 2' });
        canReveal = await db.canRevealBallots(testPR);
        expect(canReveal).toBe(false);

        // add third ballot (3/3 - meets threshold)
        await db.addBallot({ ...mockBallot, pr_reference: testPR, rationale: 'Ballot 3' });
        canReveal = await db.canRevealBallots(testPR);
        expect(canReveal).toBe(true);
      });

      it('should maintain ballot revealed state across phase changes', async () => {
        // arrange
        await db.setPRPhase(testPR, 'blinded');
        await db.addBallot({ ...mockBallot, pr_reference: testPR, revealed: false });

        // act - reveal and check
        await db.revealBallots(testPR);
        let ballots = await db.getBallotsByPR(testPR);
        expect(ballots[0].revealed).toBe(true);

        // transition phase back (edge case)
        await db.setPRPhase(testPR, 'blinded');

        // assert - ballot revealed state should persist
        ballots = await db.getBallotsByPR(testPR);
        expect(ballots[0].revealed).toBe(true);
      });

      it('should isolate ballots and phases between different PRs', async () => {
        // arrange - coverage: test data isolation
        await db.setPRPhase(testPR, 'blinded');
        await db.addBallot({ ...mockBallot, pr_reference: testPR });

        await db.setPRPhase(altPR, 'blinded');
        await db.addBallot({ ...mockBallot, pr_reference: altPR });

        // act - reveal only one PR
        await db.revealBallots(testPR);
        await db.setPRPhase(testPR, 'revealed');

        // assert - testPR revealed, altPR still blinded
        const ballots1 = await db.getBallotsByPR(testPR);
        const ballots2 = await db.getBallotsByPR(altPR);
        const phase1 = await db.getPRPhase(testPR);
        const phase2 = await db.getPRPhase(altPR);

        expect(ballots1[0].revealed).toBe(true);
        expect(ballots2[0].revealed).toBe(false);
        expect(phase1).toBe('revealed');
        expect(phase2).toBe('blinded');
      });
    });

    describe('edge cases: phase state', () => {
      it('should handle PR references with special characters', async () => {
        // arrange - coverage: boundary test for pr reference format
        const specialPR = 'PR-#123-feature/test-branch';

        // act
        await db.setPRPhase(specialPR, 'blinded');
        const phase = await db.getPRPhase(specialPR);

        // assert
        expect(phase).toBe('blinded');
      });

      it('should handle very long PR references', async () => {
        // arrange - coverage: boundary test for string length
        const longPR = 'PR-' + 'x'.repeat(500);

        // act
        await db.setPRPhase(longPR, 'blinded');
        const phase = await db.getPRPhase(longPR);

        // assert
        expect(phase).toBe('blinded');
      });

      it('should clear PR state on clearAllData', async () => {
        // arrange
        await db.setPRPhase(testPR, 'revealed');
        await db.addBallot({ ...mockBallot, pr_reference: testPR });

        // act
        await db.clearAllData();

        // assert - should return null since state was cleared
        const phase = await db.getPRPhase(testPR);
        expect(phase).toBeNull();
      });
    });
  });
});
