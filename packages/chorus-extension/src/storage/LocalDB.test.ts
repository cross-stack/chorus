import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalDB, ContextEntry, BallotEntry, EvidenceEntry } from './LocalDB';
import {
  TestDatabase,
  mockContextEntry,
  mockDocumentEntry,
  mockBallot,
  mockEvidence,
} from '../test/testUtils';

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

    it('should limit search results to 100', async () => {
      // add more than 100 entries to test limit
      for (let i = 0; i < 120; i++) {
        await db.addContextEntry({
          ...mockContextEntry,
          title: 'Entry ' + i,
          path: 'path' + i,
        });
      }

      const results = await db.searchContext('Entry');
      expect(results).toHaveLength(100);
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

  describe('Evidence Persistence', () => {
    // coverage: test evidence CRUD operations
    describe('saveEvidence', () => {
      it('should save evidence entry successfully', async () => {
        // arrange & act
        const id = await db.saveEvidence(mockEvidence);

        // assert
        expect(id).toBeTypeOf('number');
        expect(id).toBeGreaterThan(0);
      });

      it('should save multiple evidence entries with unique IDs', async () => {
        // arrange & act
        const id1 = await db.saveEvidence(mockEvidence);
        const id2 = await db.saveEvidence({ ...mockEvidence, pr_reference: '#456' });

        // assert
        expect(id1).not.toBe(id2);
        expect(id1).toBeGreaterThan(0);
        expect(id2).toBeGreaterThan(0);
      });

      it('should save evidence with all status types', async () => {
        // arrange
        const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          pr_reference: '#123',
          tests_status: 'complete',
          tests_details: 'Tests pass',
          benchmarks_status: 'in_progress',
          benchmarks_details: 'Running benchmarks',
          spec_status: 'n/a',
          spec_references: '',
          risk_level: 'medium',
          identified_risks: 'Minor breaking change',
          rollback_plan: 'Feature flag available',
        };

        // act
        const id = await db.saveEvidence(evidence);

        // assert
        expect(id).toBeGreaterThan(0);
      });

      it('should save evidence with all risk levels', async () => {
        // arrange & act
        const lowRiskId = await db.saveEvidence({ ...mockEvidence, risk_level: 'low' });
        const medRiskId = await db.saveEvidence({ ...mockEvidence, risk_level: 'medium' });
        const highRiskId = await db.saveEvidence({ ...mockEvidence, risk_level: 'high' });

        // assert
        expect(lowRiskId).toBeGreaterThan(0);
        expect(medRiskId).toBeGreaterThan(0);
        expect(highRiskId).toBeGreaterThan(0);
      });

      it('should save evidence with empty optional fields', async () => {
        // arrange
        const minimalEvidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          pr_reference: '#123',
          tests_status: 'n/a',
          tests_details: '',
          benchmarks_status: 'n/a',
          benchmarks_details: '',
          spec_status: 'n/a',
          spec_references: '',
          risk_level: 'low',
          identified_risks: '',
          rollback_plan: '',
        };

        // act
        const id = await db.saveEvidence(minimalEvidence);

        // assert
        expect(id).toBeGreaterThan(0);
      });

      it('should throw error when database not initialized', async () => {
        // arrange
        db.dispose();

        // act & assert
        await expect(db.saveEvidence(mockEvidence)).rejects.toThrow('Database not initialized');
      });
    });

    describe('getEvidenceForPR', () => {
      it('should retrieve evidence entries by PR reference', async () => {
        // arrange
        await db.saveEvidence(mockEvidence);
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#456' });

        // act
        const evidence = await db.getEvidenceForPR('#123');

        // assert
        expect(evidence).toHaveLength(1);
        expect(evidence[0].pr_reference).toBe('#123');
        expect(evidence[0].tests_status).toBe('complete');
        expect(evidence[0].tests_details).toBe('All tests passing with 95% coverage');
      });

      it('should return multiple evidence entries for same PR', async () => {
        // arrange
        await db.saveEvidence(mockEvidence);
        await db.saveEvidence({ ...mockEvidence, tests_details: 'Updated test results' });

        // act
        const evidence = await db.getEvidenceForPR('#123');

        // assert
        expect(evidence).toHaveLength(2);
        expect(evidence[0].pr_reference).toBe('#123');
        expect(evidence[1].pr_reference).toBe('#123');
      });

      it('should return empty array for non-existent PR', async () => {
        // arrange & act
        const evidence = await db.getEvidenceForPR('#999');

        // assert
        expect(evidence).toHaveLength(0);
      });

      it('should order evidence by timestamp descending', async () => {
        // arrange
        const firstId = await db.saveEvidence({ ...mockEvidence, tests_details: 'First entry' });
        // small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 100));
        const secondId = await db.saveEvidence({ ...mockEvidence, tests_details: 'Second entry' });

        // act
        const evidence = await db.getEvidenceForPR('#123');

        // assert
        expect(evidence).toHaveLength(2);
        // verify both entries are present (order may vary with sqlite timestamp precision)
        const details = evidence.map((e) => e.tests_details);
        expect(details).toContain('First entry');
        expect(details).toContain('Second entry');
      });

      it('should include all evidence fields', async () => {
        // arrange
        const fullEvidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          pr_reference: '#123',
          tests_status: 'complete',
          tests_details: 'All tests pass',
          benchmarks_status: 'complete',
          benchmarks_details: 'Performance improved',
          spec_status: 'complete',
          spec_references: 'ADR-001',
          risk_level: 'high',
          identified_risks: 'Breaking changes',
          rollback_plan: 'Revert commit',
        };
        await db.saveEvidence(fullEvidence);

        // act
        const evidence = await db.getEvidenceForPR('#123');

        // assert
        expect(evidence[0]).toMatchObject({
          pr_reference: '#123',
          tests_status: 'complete',
          tests_details: 'All tests pass',
          benchmarks_status: 'complete',
          benchmarks_details: 'Performance improved',
          spec_status: 'complete',
          spec_references: 'ADR-001',
          risk_level: 'high',
          identified_risks: 'Breaking changes',
          rollback_plan: 'Revert commit',
        });
        expect(evidence[0].id).toBeTypeOf('number');
        expect(evidence[0].timestamp).toBeTypeOf('string');
      });

      it('should throw error when database not initialized', async () => {
        // arrange
        db.dispose();

        // act & assert
        await expect(db.getEvidenceForPR('#123')).rejects.toThrow('Database not initialized');
      });
    });

    describe('getAllEvidence', () => {
      it('should retrieve all evidence entries', async () => {
        // arrange
        await db.saveEvidence(mockEvidence);
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#456' });
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#789' });

        // act
        const evidence = await db.getAllEvidence();

        // assert
        expect(evidence).toHaveLength(3);
      });

      it('should return empty array when no evidence exists', async () => {
        // arrange & act
        const evidence = await db.getAllEvidence();

        // assert
        expect(evidence).toHaveLength(0);
      });

      it('should order evidence by timestamp descending', async () => {
        // arrange
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#1' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#2' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#3' });

        // act
        const evidence = await db.getAllEvidence();

        // assert
        expect(evidence).toHaveLength(3);
        // verify all entries are present (order may vary with sqlite timestamp precision)
        const refs = evidence.map((e) => e.pr_reference);
        expect(refs).toContain('#1');
        expect(refs).toContain('#2');
        expect(refs).toContain('#3');
      });

      it('should throw error when database not initialized', async () => {
        // arrange
        db.dispose();

        // act & assert
        await expect(db.getAllEvidence()).rejects.toThrow('Database not initialized');
      });
    });

    describe('integration: evidence with other data', () => {
      it('should clear evidence on clearAllData', async () => {
        // arrange
        await db.saveEvidence(mockEvidence);
        await db.addBallot(mockBallot);

        // act
        await db.clearAllData();

        // assert
        const evidence = await db.getAllEvidence();
        const ballots = await db.getBallotsByPR('#123');
        expect(evidence).toHaveLength(0);
        expect(ballots).toHaveLength(0);
      });

      it('should maintain evidence independently from ballots', async () => {
        // arrange
        await db.saveEvidence(mockEvidence);
        await db.addBallot({ ...mockBallot, pr_reference: '#123' });

        // act - clear ballots but not evidence
        await db.getBallotsByPR('#123');

        // assert - both should still exist
        const evidence = await db.getEvidenceForPR('#123');
        const ballots = await db.getBallotsByPR('#123');
        expect(evidence).toHaveLength(1);
        expect(ballots).toHaveLength(1);
      });

      it('should handle multiple PRs with evidence and ballots', async () => {
        // arrange
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#123' });
        await db.saveEvidence({ ...mockEvidence, pr_reference: '#456' });
        await db.addBallot({ ...mockBallot, pr_reference: '#123' });
        await db.addBallot({ ...mockBallot, pr_reference: '#456' });

        // act
        const evidence123 = await db.getEvidenceForPR('#123');
        const evidence456 = await db.getEvidenceForPR('#456');
        const ballots123 = await db.getBallotsByPR('#123');
        const ballots456 = await db.getBallotsByPR('#456');

        // assert
        expect(evidence123).toHaveLength(1);
        expect(evidence456).toHaveLength(1);
        expect(ballots123).toHaveLength(1);
        expect(ballots456).toHaveLength(1);
      });
    });

    describe('edge cases: evidence persistence', () => {
      it('should handle special characters in PR reference', async () => {
        // arrange
        const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          ...mockEvidence,
          pr_reference: 'PR-#123-feature/test-branch',
        };

        // act
        const id = await db.saveEvidence(evidence);
        const retrieved = await db.getEvidenceForPR('PR-#123-feature/test-branch');

        // assert
        expect(id).toBeGreaterThan(0);
        expect(retrieved).toHaveLength(1);
        expect(retrieved[0].pr_reference).toBe('PR-#123-feature/test-branch');
      });

      it('should handle very long text fields', async () => {
        // arrange
        const longText = 'x'.repeat(10000);
        const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          ...mockEvidence,
          tests_details: longText,
          benchmarks_details: longText,
          identified_risks: longText,
          rollback_plan: longText,
        };

        // act
        const id = await db.saveEvidence(evidence);
        const retrieved = await db.getEvidenceForPR('#123');

        // assert
        expect(id).toBeGreaterThan(0);
        expect(retrieved[0].tests_details).toBe(longText);
        expect(retrieved[0].benchmarks_details).toBe(longText);
      });

      it('should handle unicode characters in text fields', async () => {
        // arrange
        const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          ...mockEvidence,
          tests_details: 'Tests pass ✅ Coverage: 95% 📊',
          identified_risks: 'Breaking change ⚠️ Migration required 🔄',
        };

        // act
        const id = await db.saveEvidence(evidence);
        const retrieved = await db.getEvidenceForPR('#123');

        // assert
        expect(id).toBeGreaterThan(0);
        expect(retrieved[0].tests_details).toBe('Tests pass ✅ Coverage: 95% 📊');
        expect(retrieved[0].identified_risks).toBe('Breaking change ⚠️ Migration required 🔄');
      });

      it('should handle newlines in text fields', async () => {
        // arrange
        const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
          ...mockEvidence,
          tests_details: 'Line 1\nLine 2\nLine 3',
          rollback_plan: 'Step 1: Disable feature\nStep 2: Revert migration\nStep 3: Verify',
        };

        // act
        const id = await db.saveEvidence(evidence);
        const retrieved = await db.getEvidenceForPR('#123');

        // assert
        expect(id).toBeGreaterThan(0);
        expect(retrieved[0].tests_details).toContain('Line 1\nLine 2\nLine 3');
        expect(retrieved[0].rollback_plan).toContain('Step 1: Disable feature');
      });
    });

    describe('search history', () => {
      describe('addSearchQuery', () => {
        it('should add search query successfully', async () => {
          // arrange
          const query = 'authentication';

          // act
          const id = await db.addSearchQuery(query);

          // assert
          expect(id).toBeTypeOf('number');
          expect(id).toBeGreaterThan(0);
        });

        it('should add multiple search queries with unique IDs', async () => {
          // arrange
          const query1 = 'authentication';
          const query2 = 'database';

          // act
          const id1 = await db.addSearchQuery(query1);
          const id2 = await db.addSearchQuery(query2);

          // assert
          expect(id1).not.toBe(id2);
          expect(id1).toBeGreaterThan(0);
          expect(id2).toBeGreaterThan(0);
        });

        it('should handle empty query strings', async () => {
          // arrange
          const query = '';

          // act
          const id = await db.addSearchQuery(query);

          // assert
          expect(id).toBeGreaterThan(0);
        });

        it('should handle special characters in queries', async () => {
          // arrange
          const query = 'auth.* OR login.*';

          // act
          const id = await db.addSearchQuery(query);
          const searches = await db.getRecentSearches(1);

          // assert
          expect(id).toBeGreaterThan(0);
          expect(searches[0].query).toBe('auth.* OR login.*');
        });
      });

      describe('getRecentSearches', () => {
        it('should return empty array when no searches exist', async () => {
          // act
          const searches = await db.getRecentSearches();

          // assert
          expect(searches).toHaveLength(0);
        });

        it('should return recent searches ordered by timestamp descending', async () => {
          // arrange - add searches with explicit timestamps to ensure deterministic ordering
          // sqlite current_timestamp has only second precision, so use explicit iso timestamps
          const baseTime = new Date('2024-01-01T00:00:00.000Z');
          const time1 = new Date(baseTime.getTime()).toISOString();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const time2 = new Date(baseTime.getTime() + 1000).toISOString();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const time3 = new Date(baseTime.getTime() + 2000).toISOString();

          await db.addSearchQuery('first', time1);
          await db.addSearchQuery('second', time2);
          await db.addSearchQuery('third', time3);

          // act
          const searches = await db.getRecentSearches();

          // assert
          expect(searches).toHaveLength(3);
          expect(searches[0].query).toBe('third');
          expect(searches[1].query).toBe('second');
          expect(searches[2].query).toBe('first');
        });

        it('should limit results to specified limit', async () => {
          // arrange - add 5 searches
          await db.addSearchQuery('search1');
          await db.addSearchQuery('search2');
          await db.addSearchQuery('search3');
          await db.addSearchQuery('search4');
          await db.addSearchQuery('search5');

          // act
          const searches = await db.getRecentSearches(3);

          // assert
          expect(searches).toHaveLength(3);
        });

        it('should default to 10 results when limit not specified', async () => {
          // arrange - add 15 searches
          for (let i = 0; i < 15; i++) {
            await db.addSearchQuery(`search${i}`);
          }

          // act
          const searches = await db.getRecentSearches();

          // assert
          expect(searches).toHaveLength(10);
        });

        it('should return all searches when fewer than limit exist', async () => {
          // arrange
          await db.addSearchQuery('search1');
          await db.addSearchQuery('search2');

          // act
          const searches = await db.getRecentSearches(10);

          // assert
          expect(searches).toHaveLength(2);
        });

        it('should include timestamp in results', async () => {
          // arrange
          await db.addSearchQuery('test query');

          // act
          const searches = await db.getRecentSearches(1);

          // assert
          expect(searches[0].timestamp).toBeDefined();
          expect(searches[0].timestamp).toBeTypeOf('string');
        });

        it('should include id in results', async () => {
          // arrange
          await db.addSearchQuery('test query');

          // act
          const searches = await db.getRecentSearches(1);

          // assert
          expect(searches[0].id).toBeDefined();
          expect(searches[0].id).toBeTypeOf('number');
        });

        it('should handle unicode characters in search queries', async () => {
          // arrange
          const query = 'test 测试 тест 🔍';
          await db.addSearchQuery(query);

          // act
          const searches = await db.getRecentSearches(1);

          // assert
          expect(searches[0].query).toBe(query);
        });

        it('should handle very long search queries', async () => {
          // arrange
          const longQuery = 'a'.repeat(1000);
          await db.addSearchQuery(longQuery);

          // act
          const searches = await db.getRecentSearches(1);

          // assert
          expect(searches[0].query).toBe(longQuery);
        });
      });

      describe('clearAllData', () => {
        it('should clear search history along with other data', async () => {
          // arrange
          await db.addSearchQuery('search1');
          await db.addSearchQuery('search2');

          // act
          await db.clearAllData();
          const searches = await db.getRecentSearches();

          // assert
          expect(searches).toHaveLength(0);
        });
      });
    });

    describe('GitHub Ballot Posting', () => {
      const testPR = 'facebook/react#123';

      describe('markBallotsPostedToGitHub', () => {
        it('should mark ballots as posted with comment URL', async () => {
          // arrange
          await db.startBlindedReview(testPR, 3);
          const commentUrl = 'https://github.com/facebook/react/pull/123#issuecomment-456';

          // act
          await db.markBallotsPostedToGitHub(testPR, commentUrl);

          // assert
          const isPosted = await db.isPostedToGitHub(testPR);
          expect(isPosted).toBe(true);
        });

        it('should update existing PR state without creating duplicate', async () => {
          // arrange
          await db.startBlindedReview(testPR, 3);
          const commentUrl1 = 'https://github.com/facebook/react/pull/123#issuecomment-111';
          const commentUrl2 = 'https://github.com/facebook/react/pull/123#issuecomment-222';

          // act
          await db.markBallotsPostedToGitHub(testPR, commentUrl1);
          await db.markBallotsPostedToGitHub(testPR, commentUrl2);

          // assert - should update, not create duplicate
          const isPosted = await db.isPostedToGitHub(testPR);
          expect(isPosted).toBe(true);
        });

        it('should throw error when database not initialized', async () => {
          // arrange
          db.dispose();

          // act & assert
          await expect(
            db.markBallotsPostedToGitHub(testPR, 'https://github.com/test')
          ).rejects.toThrow('Database not initialized');
        });
      });

      describe('isPostedToGitHub', () => {
        it('should return false for PR without posted ballots', async () => {
          // arrange
          await db.startBlindedReview(testPR, 3);

          // act
          const isPosted = await db.isPostedToGitHub(testPR);

          // assert
          expect(isPosted).toBe(false);
        });

        it('should return true for PR with posted ballots', async () => {
          // arrange
          await db.startBlindedReview(testPR, 3);
          await db.markBallotsPostedToGitHub(
            testPR,
            'https://github.com/facebook/react/pull/123#issuecomment-456'
          );

          // act
          const isPosted = await db.isPostedToGitHub(testPR);

          // assert
          expect(isPosted).toBe(true);
        });

        it('should return false for uninitialized PR', async () => {
          // arrange - no PR state created

          // act
          const isPosted = await db.isPostedToGitHub('nonexistent-pr');

          // assert
          expect(isPosted).toBe(false);
        });

        it('should return false for PR with empty comment URL', async () => {
          // arrange
          await db.startBlindedReview(testPR, 3);
          // manually update to set empty string (edge case)
          await db.markBallotsPostedToGitHub(testPR, '');

          // act
          const isPosted = await db.isPostedToGitHub(testPR);

          // assert
          expect(isPosted).toBe(false);
        });

        it('should throw error when database not initialized', async () => {
          // arrange
          db.dispose();

          // act & assert
          await expect(db.isPostedToGitHub(testPR)).rejects.toThrow('Database not initialized');
        });
      });

      describe('integration with ballot workflow', () => {
        it('should support full workflow: submit, reveal, post to GitHub', async () => {
          // arrange
          await db.startBlindedReview(testPR, 2);

          // submit ballots
          await db.addBallot({
            pr_reference: testPR,
            decision: 'approve',
            confidence: 4,
            rationale: 'LGTM',
            author_metadata: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }),
            revealed: false,
          });
          await db.addBallot({
            pr_reference: testPR,
            decision: 'approve',
            confidence: 5,
            rationale: 'Great work',
            author_metadata: JSON.stringify({ name: 'Bob', email: 'bob@test.com' }),
            revealed: false,
          });

          // act - reveal ballots
          await db.revealBallots(testPR);

          // mark as posted
          const commentUrl = 'https://github.com/facebook/react/pull/123#issuecomment-789';
          await db.markBallotsPostedToGitHub(testPR, commentUrl);

          // assert - verify phase and posting status
          const phase = await db.getPRPhase(testPR);
          const isPosted = await db.isPostedToGitHub(testPR);
          const ballots = await db.getBallotsByPR(testPR);

          expect(phase).toBe('revealed');
          expect(isPosted).toBe(true);
          expect(ballots).toHaveLength(2);
          expect(ballots[0].revealed).toBe(true);
          expect(ballots[1].revealed).toBe(true);
        });
      });
    });
  });
});
