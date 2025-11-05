import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

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
  private db: Database | null = null;
  private sql: SqlJsStatic | null = null;
  private readonly dbPath: string;

  constructor(storagePath: string) {
    this.dbPath = path.join(storagePath, 'chorus.db');
  }

  async initialize(): Promise<void> {
    try {
      console.log(`LocalDB: Database path: ${this.dbPath}`);

      // ensure storage directory exists
      const storageDir = path.dirname(this.dbPath);
      console.log(`LocalDB: Creating storage directory: ${storageDir}`);
      await fs.mkdir(storageDir, { recursive: true });
      console.log(`LocalDB: Storage directory created`);

      console.log(`LocalDB: Loading sql.js library...`);
      // load sql.js library asynchronously (no blocking operations)
      this.sql = await initSqlJs();
      console.log(`LocalDB: sql.js library loaded`);

      // try to load existing database file, or create new in-memory database
      try {
        console.log(`LocalDB: Attempting to load database from file...`);
        const fileData = await fs.readFile(this.dbPath);
        this.db = new this.sql.Database(fileData);
        console.log(`LocalDB: Database loaded from file successfully`);
      } catch (fileError) {
        // file doesn't exist or can't be read - create new in-memory database
        console.log(`LocalDB: No existing database found, creating new database...`);
        this.db = new this.sql.Database();
        console.log(`LocalDB: New in-memory database created`);
      }

      console.log(`LocalDB: Creating tables...`);
      await this.createTables();
      console.log(`LocalDB: Tables created successfully`);

      // persist database to file after initialization
      await this.persistToFile();
    } catch (error) {
      console.error(`LocalDB: Initialization error:`, error);
      throw new Error(
        `Failed to Initialize Database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Persists the in-memory database to disk.
   * sql.js operates in-memory by default, so we must explicitly export to file.
   * Called after initialization and after any write operations.
   */
  private async persistToFile(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fs.writeFile(this.dbPath, buffer);
      console.log(`LocalDB: Database persisted to ${this.dbPath}`);
    } catch (error) {
      console.error(`LocalDB: Failed to persist database:`, error);
      // don't throw - persistence failure shouldn't break operations
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // sql.js uses .run() for DDL statements
    // context entries table
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_context_type ON context_entries(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_context_path ON context_entries(path)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ballots_pr ON ballots(pr_reference)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_pr_state_phase ON pr_state(phase)`);
  }

  async addContextEntry(entry: Omit<ContextEntry, 'id' | 'indexed_at'>): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // sql.js API: use .run() with bind parameters
    const stmt = this.db.prepare(`
			INSERT INTO context_entries (type, title, path, content, metadata)
			VALUES (?, ?, ?, ?, ?)
		`);

    stmt.bind([entry.type, entry.title, entry.path, entry.content, JSON.stringify(entry.metadata)]);

    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
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
    stmt.bind(params);

    const rows: ContextEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        ...row,
        metadata: JSON.parse(row.metadata),
      });
    }

    stmt.free();
    return rows;
  }

  async addBallot(ballot: Omit<BallotEntry, 'id' | 'created_at'>): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			INSERT INTO ballots (pr_reference, decision, confidence, rationale, author_metadata, revealed)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

    stmt.bind([
      ballot.pr_reference,
      ballot.decision,
      ballot.confidence,
      ballot.rationale,
      ballot.author_metadata,
      ballot.revealed ? 1 : 0,
    ]);

    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
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

    stmt.bind([prReference]);

    const rows: BallotEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        ...row,
        revealed: Boolean(row.revealed),
      });
    }

    stmt.free();
    return rows;
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

    // sql.js doesn't have explicit transactions like better-sqlite3,
    // but we can execute multiple statements sequentially
    // update ballot revealed flags
    const ballotsStmt = this.db.prepare(`
			UPDATE ballots
			SET revealed = 1
			WHERE pr_reference = ?
		`);
    ballotsStmt.bind([prReference]);
    ballotsStmt.step();
    ballotsStmt.free();

    // transition PR phase to revealed
    const phaseStmt = this.db.prepare(`
			UPDATE pr_state
			SET phase = 'revealed',
				updated_at = CURRENT_TIMESTAMP
			WHERE pr_reference = ?
		`);
    phaseStmt.bind([prReference]);
    phaseStmt.step();
    phaseStmt.free();

    await this.persistToFile();
  }

  async clearAllData(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.run('DELETE FROM context_entries');
    this.db.run('DELETE FROM ballots');
    this.db.run('DELETE FROM pr_state');

    await this.persistToFile();
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

    stmt.bind([prReference]);

    let phase: 'blinded' | 'revealed' | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { phase: 'blinded' | 'revealed' };
      phase = row.phase;
    }

    stmt.free();

    // return null if PR hasn't been initialized yet
    return phase;
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

    // sql.js doesn't support UPSERT directly, so we implement it manually
    // first try to update
    const updateStmt = this.db.prepare(`
			UPDATE pr_state
			SET phase = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE pr_reference = ?
		`);
    updateStmt.bind([phase, prReference]);
    updateStmt.step();
    updateStmt.free();

    // check if update affected any rows
    const changes = this.db.exec('SELECT changes() as count')[0].values[0][0] as number;

    // if no rows were updated, insert new row
    if (changes === 0) {
      const insertStmt = this.db.prepare(`
				INSERT INTO pr_state (pr_reference, phase, updated_at)
				VALUES (?, ?, CURRENT_TIMESTAMP)
			`);
      insertStmt.bind([prReference, phase]);
      insertStmt.step();
      insertStmt.free();
    }

    await this.persistToFile();
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

    // implement upsert manually: try update first, then insert if needed
    const updateStmt = this.db.prepare(`
			UPDATE pr_state
			SET ballot_threshold = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE pr_reference = ?
		`);
    updateStmt.bind([threshold, prReference]);
    updateStmt.step();
    updateStmt.free();

    // check if update affected any rows
    const changes = this.db.exec('SELECT changes() as count')[0].values[0][0] as number;

    // if no rows were updated, insert new row
    if (changes === 0) {
      const insertStmt = this.db.prepare(`
				INSERT INTO pr_state (pr_reference, phase, ballot_threshold, created_at, updated_at)
				VALUES (?, 'blinded', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			`);
      insertStmt.bind([prReference, threshold]);
      insertStmt.step();
      insertStmt.free();
    }

    await this.persistToFile();
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
    stateStmt.bind([prReference]);

    let threshold = 3; // default
    if (stateStmt.step()) {
      const state = stateStmt.getAsObject() as { ballot_threshold: number };
      threshold = state.ballot_threshold;
    }
    stateStmt.free();

    // check if ballot count meets threshold
    const countStmt = this.db.prepare(`
			SELECT COUNT(*) as count FROM ballots
			WHERE pr_reference = ?
		`);
    countStmt.bind([prReference]);
    countStmt.step();
    const result = countStmt.getAsObject() as { count: number };
    countStmt.free();

    return result.count >= threshold;
  }

  dispose(): void {
    if (this.db) {
      // export database one final time before closing
      try {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFile(this.dbPath, buffer).catch(() => {
          // ignore errors on dispose
        });
      } catch (error) {
        // ignore errors on dispose
      }

      this.db.close();
      this.db = null;
    }
    this.sql = null;
  }
}
