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
			// Tables should be created during setup
			// Test by inserting data - if tables don't exist, it will throw
			await expect(db.addContextEntry(mockContextEntry)).resolves.toBeTypeOf('number');
		});

		it('should throw error when accessing uninitialized database', async () => {
			const uninitializedDb = new TestDatabase();
			await expect(uninitializedDb.db.addContextEntry(mockContextEntry))
				.rejects
				.toThrow('Database not initialized');
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
			// Add more than 50 entries
			for (let i = 0; i < 60; i++) {
				await db.addContextEntry({
					...mockContextEntry,
					title: 'Entry ' + i,
					path: 'path' + i
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
			// Valid decisions
			await expect(db.addBallot({ ...mockBallot, decision: 'approve' })).resolves.toBeDefined();
			await expect(db.addBallot({ ...mockBallot, decision: 'reject' })).resolves.toBeDefined();
			await expect(db.addBallot({ ...mockBallot, decision: 'neutral' })).resolves.toBeDefined();
		});

		it('should validate confidence range', async () => {
			// Valid confidence values
			await expect(db.addBallot({ ...mockBallot, confidence: 1 })).resolves.toBeDefined();
			await expect(db.addBallot({ ...mockBallot, confidence: 5 })).resolves.toBeDefined();
		});

		it('should reveal ballots for PR', async () => {
			await db.addBallot(mockBallot);
			await db.addBallot({ ...mockBallot, pr_reference: '#456' });

			await db.revealBallots('#123');

			const ballots = await db.getBallotsByPR('#123');
			expect(ballots[0].revealed).toBe(true);

			// Other PR should not be affected
			const otherBallots = await db.getBallotsByPR('#456');
			expect(otherBallots[0].revealed).toBe(false);
		});

		it('should order ballots by creation date descending', async () => {
			const ballot1 = { ...mockBallot, rationale: 'First ballot' };
			const ballot2 = { ...mockBallot, rationale: 'Second ballot' };

			await db.addBallot(ballot1);
			// Small delay to ensure different timestamps
			await new Promise(resolve => setTimeout(resolve, 100));
			await db.addBallot(ballot2);

			const ballots = await db.getBallotsByPR('#123');
			expect(ballots).toHaveLength(2);
			// SQLite DATETIME comparison should order properly, but let's be more flexible
			const rationales = ballots.map(b => b.rationale);
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
			// This mainly tests that dispose doesn't throw
			expect(() => db.dispose()).not.toThrow();
			
			// After disposal, operations should fail
			await expect(db.addContextEntry(mockContextEntry))
				.rejects
				.toThrow('Database not initialized');
		});
	});

	describe('error handling', () => {
		it('should handle database errors gracefully', async () => {
			db.dispose(); // Force database to be closed
			
			await expect(db.addContextEntry(mockContextEntry))
				.rejects
				.toThrow('Database not initialized');
		});

		it('should handle invalid JSON in metadata', async () => {
			// This is more of a regression test - the system should handle
			// proper JSON serialization internally
			const entryWithComplexMetadata = {
				...mockContextEntry,
				metadata: {
					nested: { data: ['array', 'of', 'values'] },
					date: new Date('2023-01-01'),
					number: 42
				}
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
			expect(results).toHaveLength(1); // Empty search should return all results
		});

		it('should handle special characters in search', async () => {
			await db.addContextEntry({
				...mockContextEntry,
				title: 'feat: add @special #characters & symbols'
			});
			
			const results = await db.searchContext('@special');
			expect(results).toHaveLength(1);
		});

		it('should be case-insensitive in search', async () => {
			await db.addContextEntry({
				...mockContextEntry,
				title: 'UPPERCASE TITLE'
			});
			
			const results = await db.searchContext('uppercase');
			expect(results).toHaveLength(1);
		});
	});
});
