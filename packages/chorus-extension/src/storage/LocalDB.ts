import * as path from 'path';
import * as fs from 'fs/promises';
import Database from 'better-sqlite3';
import * as vscode from 'vscode';

export interface ContextEntry {
	id?: number;
	type: 'pr' | 'commit' | 'doc' | 'incident';
	title: string;
	path: string;
	content: string;
	metadata: Record<string, any>;
	indexed_at: string;
}

export interface BallotEntry {
	id?: number;
	pr_reference: string;
	decision: 'approve' | 'reject' | 'neutral';
	confidence: number; // 1-5
	rationale: string;
	author_metadata: string; // JSON string, revealed after submission
	created_at: string;
	revealed: boolean;
}

/**
 * PR state tracking for ballot workflow phases
 */
export interface PRState {
	pr_reference: string;
	phase: 'blinded' | 'revealed';
	ballot_threshold: number;
	first_pass_deadline?: string;
	created_at: string;
	updated_at: string;
}

export class LocalDB implements vscode.Disposable {
	private db: Database.Database | null = null;
	private readonly dbPath: string;

	constructor(storagePath: string) {
		this.dbPath = path.join(storagePath, 'chorus.db');
	}

	async initialize(): Promise<void> {
		try {
			// ensure storage directory exists
			await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

			this.db = new Database(this.dbPath);
			this.db.pragma('journal_mode = WAL');
			
			await this.createTables();
		} catch (error) {
			throw new Error(`Failed to initialize database: ${error}`);
		}
	}

	private async createTables(): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		// context entries table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS context_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				type TEXT NOT NULL,
				title TEXT NOT NULL,
				path TEXT NOT NULL,
				content TEXT NOT NULL,
				metadata TEXT NOT NULL DEFAULT '{}',
				indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// ballots table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS ballots (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_reference TEXT NOT NULL,
				decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'neutral')),
				confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
				rationale TEXT NOT NULL,
				author_metadata TEXT NOT NULL DEFAULT '{}',
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				revealed INTEGER NOT NULL DEFAULT 0
			)
		`);

		// pr_state table - tracks review workflow phases
		// phase 'blinded': reviewers submit anonymous ballots, author info hidden
		// phase 'revealed': ballots are revealed, discussion phase begins
		// this separation supports double-blind review and reduces anchoring bias
		// ballot_threshold: minimum number of ballots required before reveal is allowed
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pr_state (
				pr_reference TEXT PRIMARY KEY,
				phase TEXT NOT NULL CHECK (phase IN ('blinded', 'revealed')),
				ballot_threshold INTEGER NOT NULL DEFAULT 3,
				first_pass_deadline DATETIME,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// create indexes for better search performance
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_context_type ON context_entries(type);
			CREATE INDEX IF NOT EXISTS idx_context_path ON context_entries(path);
			CREATE INDEX IF NOT EXISTS idx_ballots_pr ON ballots(pr_reference);
			CREATE INDEX IF NOT EXISTS idx_pr_state_phase ON pr_state(phase);
		`);
	}

	async addContextEntry(entry: Omit<ContextEntry, 'id' | 'indexed_at'>): Promise<number> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		const stmt = this.db.prepare(`
			INSERT INTO context_entries (type, title, path, content, metadata)
			VALUES (?, ?, ?, ?, ?)
		`);

		const result = stmt.run(
			entry.type,
			entry.title,
			entry.path,
			entry.content,
			JSON.stringify(entry.metadata)
		);

		return result.lastInsertRowid as number;
	}

	async searchContext(query: string, type?: string): Promise<ContextEntry[]> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		let sql = `
			SELECT * FROM context_entries 
			WHERE content LIKE ? OR title LIKE ?
		`;
		const params: any[] = [`%${query}%`, `%${query}%`];

		if (type) {
			sql += ' AND type = ?';
			params.push(type);
		}

		sql += ' ORDER BY indexed_at DESC LIMIT 50';

		const stmt = this.db.prepare(sql);
		const rows = stmt.all(...params) as any[];

		return rows.map(row => ({
			...row,
			metadata: JSON.parse(row.metadata)
		}));
	}

	async addBallot(ballot: Omit<BallotEntry, 'id' | 'created_at'>): Promise<number> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		const stmt = this.db.prepare(`
			INSERT INTO ballots (pr_reference, decision, confidence, rationale, author_metadata, revealed)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		const result = stmt.run(
			ballot.pr_reference,
			ballot.decision,
			ballot.confidence,
			ballot.rationale,
			ballot.author_metadata,
			ballot.revealed ? 1 : 0
		);

		return result.lastInsertRowid as number;
	}

	async getBallotsByPR(prReference: string): Promise<BallotEntry[]> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		const stmt = this.db.prepare(`
			SELECT * FROM ballots
			WHERE pr_reference = ?
			ORDER BY created_at DESC
		`);

		const rows = stmt.all(prReference) as any[];
		return rows.map(row => ({
			...row,
			revealed: Boolean(row.revealed)
		})) as BallotEntry[];
	}

	/**
	 * Reveals all ballots for a PR and transitions to 'revealed' phase.
	 *
	 * This is a one-way transition that:
	 * 1. Sets all ballots' revealed flag to true (makes author metadata visible)
	 * 2. Transitions PR phase from 'blinded' to 'revealed'
	 *
	 * Social psychology rationale: revelation marks the transition from independent
	 * judgment formation to collaborative deliberation. Once revealed, the social
	 * dynamics shift from private evaluation to group discussion and consensus building.
	 *
	 * @param prReference - The PR identifier
	 * @returns Promise that resolves when ballots are revealed and phase is transitioned
	 * @throws Error if database not initialized or update fails
	 */
	async revealBallots(prReference: string): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		// use transaction to ensure atomic update of both ballots and phase
		const transaction = this.db.transaction(() => {
			// update ballot revealed flags
			const ballotsStmt = this.db!.prepare(`
				UPDATE ballots
				SET revealed = 1
				WHERE pr_reference = ?
			`);
			ballotsStmt.run(prReference);

			// transition PR phase to revealed
			const phaseStmt = this.db!.prepare(`
				UPDATE pr_state
				SET phase = 'revealed',
					updated_at = CURRENT_TIMESTAMP
				WHERE pr_reference = ?
			`);
			phaseStmt.run(prReference);
		});

		transaction();
	}

	async clearAllData(): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		this.db.exec('DELETE FROM context_entries');
		this.db.exec('DELETE FROM ballots');
		this.db.exec('DELETE FROM pr_state');
	}

	/**
	 * Gets the current review phase for a PR.
	 *
	 * Returns 'blinded' if the PR is in the initial anonymous review phase,
	 * or 'revealed' if ballots have been revealed and discussion has begun.
	 * Returns null if PR state hasn't been initialized.
	 *
	 * Social psychology rationale: the blinded phase prevents anchoring bias
	 * and groupthink by ensuring reviewers form independent judgments before
	 * seeing others' opinions.
	 *
	 * @param prReference - The PR identifier (e.g., "#123" or PR URL)
	 * @returns Promise resolving to the current phase or null
	 */
	async getPRPhase(prReference: string): Promise<'blinded' | 'revealed' | null> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		const stmt = this.db.prepare(`
			SELECT phase FROM pr_state
			WHERE pr_reference = ?
		`);

		const row = stmt.get(prReference) as { phase: 'blinded' | 'revealed' } | undefined;

		// return null if PR hasn't been initialized yet
		return row ? row.phase : null;
	}

	/**
	 * Sets the review phase for a PR.
	 *
	 * Transitions between phases:
	 * - 'blinded': Initial phase where reviewers submit anonymous ballots
	 * - 'revealed': Ballots are revealed and open discussion begins
	 *
	 * Phase transitions are typically one-way (blinded -> revealed) to maintain
	 * the integrity of the double-blind review process.
	 *
	 * @param prReference - The PR identifier
	 * @param phase - The new phase to set
	 * @returns Promise that resolves when the phase is updated
	 */
	async setPRPhase(prReference: string, phase: 'blinded' | 'revealed'): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		const stmt = this.db.prepare(`
			INSERT INTO pr_state (pr_reference, phase, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(pr_reference) DO UPDATE SET
				phase = excluded.phase,
				updated_at = CURRENT_TIMESTAMP
		`);

		stmt.run(prReference, phase);
	}

	/**
	 * Initializes a PR for blinded review.
	 *
	 * Creates the initial PR state record with 'blinded' phase. Must be called
	 * before reviewers can submit ballots. Idempotent - safe to call multiple times.
	 *
	 * Social psychology rationale: explicit initialization ensures all stakeholders
	 * understand the review process will begin in anonymous mode, setting expectations
	 * for independent judgment formation.
	 *
	 * @param prReference - The PR identifier
	 * @param threshold - Minimum number of ballots required before reveal (default: 3)
	 * @returns Promise that resolves when PR state is initialized
	 */
	async startBlindedReview(prReference: string, threshold: number = 3): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		// validate threshold is positive
		if (threshold < 1) {
			throw new Error('Ballot Threshold Must Be At Least 1');
		}

		const stmt = this.db.prepare(`
			INSERT INTO pr_state (pr_reference, phase, ballot_threshold, created_at, updated_at)
			VALUES (?, 'blinded', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT(pr_reference) DO UPDATE SET
				ballot_threshold = excluded.ballot_threshold,
				updated_at = CURRENT_TIMESTAMP
		`);

		stmt.run(prReference, threshold);
	}

	/**
	 * Checks if a ballot can be submitted for this PR.
	 *
	 * Ballots can only be submitted during the 'blinded' phase to maintain
	 * the integrity of the anonymous review process. Once revealed, no new
	 * ballots can be added.
	 *
	 * @param prReference - The PR identifier
	 * @returns Promise resolving to true if ballots can be submitted
	 */
	async canSubmitBallot(prReference: string): Promise<boolean> {
		const phase = await this.getPRPhase(prReference);
		// if PR state hasn't been initialized, allow submission (auto-initialize)
		return phase === 'blinded' || phase === null;
	}

	/**
	 * Checks if ballots can be revealed for this PR.
	 *
	 * Ballots can be revealed when:
	 * 1. The PR is in 'blinded' phase (not already revealed or uninitialized)
	 * 2. Number of submitted ballots meets or exceeds the threshold
	 *
	 * Social psychology rationale: minimum threshold ensures multiple independent
	 * judgments before reveal, reducing individual bias impact and enabling
	 * social judgment scheme analysis (distribution of opinions).
	 *
	 * @param prReference - The PR identifier
	 * @returns Promise resolving to true if ballots can be revealed
	 */
	async canRevealBallots(prReference: string): Promise<boolean> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		// check if already revealed or not initialized
		const phase = await this.getPRPhase(prReference);
		if (phase !== 'blinded') {
			return false;
		}

		// get ballot threshold for this PR
		const stateStmt = this.db.prepare(`
			SELECT ballot_threshold FROM pr_state
			WHERE pr_reference = ?
		`);
		const state = stateStmt.get(prReference) as { ballot_threshold: number } | undefined;
		const threshold = state?.ballot_threshold || 3;

		// check if ballot count meets threshold
		const countStmt = this.db.prepare(`
			SELECT COUNT(*) as count FROM ballots
			WHERE pr_reference = ?
		`);
		const result = countStmt.get(prReference) as { count: number };

		return result.count >= threshold;
	}

	dispose(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}
