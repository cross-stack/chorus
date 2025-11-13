import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { EvidenceEntry } from '../types/evidence';
import {
  DecisionSchemeEntry,
  RetrospectiveEntry,
  RetrospectiveFilters,
  ReflectionAnalytics,
} from '../types/reflection';
import { NudgeResponses } from '../types/ballot';
import { EvidenceEntry } from '../types/evidence';
import {
  DecisionSchemeEntry,
  RetrospectiveEntry,
  RetrospectiveFilters,
  ReflectionAnalytics,
} from '../types/reflection';
import { NudgeResponses } from '../types/ballot';

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
  nudge_responses?: string; // JSON string with elaboration nudge responses
  nudge_responses?: string; // JSON string with elaboration nudge responses
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
  github_comment_url?: string;
  github_posted_at?: string;
  github_comment_url?: string;
  github_posted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SearchHistoryEntry {
  id?: number;
  query: string;
  timestamp: string;
}

/**
 * PR outcome tracking for calibration feedback
 */
export interface PROutcome {
  id?: number;
  pr_id: string;
  outcome_type: 'merged_clean' | 'bug_found' | 'reverted' | 'followup_required';
  detected_auto: boolean;
  user_confirmed: boolean;
  detection_details: string; // JSON with detection info
  timestamp: string;
}

/**
 * Calibration data point joining ballot with outcome
 */
export interface CalibrationDataPoint {
  pr_reference: string;
  confidence: number; // 1-5
  decision: 'approve' | 'reject' | 'neutral';
  outcome_type: string;
  outcome_success: boolean; // true if decision aligned with outcome
}

export { EvidenceEntry, DecisionSchemeEntry, RetrospectiveEntry, RetrospectiveFilters, ReflectionAnalytics, NudgeResponses };

export interface SearchHistoryEntry {
  id?: number;
  query: string;
  timestamp: string;
}

/**
 * PR outcome tracking for calibration feedback
 */
export interface PROutcome {
  id?: number;
  pr_id: string;
  outcome_type: 'merged_clean' | 'bug_found' | 'reverted' | 'followup_required';
  detected_auto: boolean;
  user_confirmed: boolean;
  detection_details: string; // JSON with detection info
  timestamp: string;
}

/**
 * Calibration data point joining ballot with outcome
 */
export interface CalibrationDataPoint {
  pr_reference: string;
  confidence: number; // 1-5
  decision: 'approve' | 'reject' | 'neutral';
  outcome_type: string;
  outcome_success: boolean; // true if decision aligned with outcome
}

export { EvidenceEntry, DecisionSchemeEntry, RetrospectiveEntry, RetrospectiveFilters, ReflectionAnalytics, NudgeResponses };

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
      let dbLoaded = false;
      let dbLoaded = false;
      try {
        console.log(`LocalDB: Attempting to load database from file...`);
        const fileData = await fs.readFile(this.dbPath);
        this.db = new this.sql.Database(fileData);
        console.log(`LocalDB: Database loaded from file successfully`);
        dbLoaded = true;
        dbLoaded = true;
      } catch (fileError) {
        // file doesn't exist or can't be read - create new in-memory database
        console.log(`LocalDB: No existing database found, creating new database...`);
        this.db = new this.sql.Database();
        console.log(`LocalDB: New in-memory database created`);
      }

      console.log(`LocalDB: Creating tables...`);
      try {
        try {
        await this.createTables();
          console.log(`LocalDB: Tables created successfully`);
      } catch (createError) {
        // if table creation fails on existing db, it's likely corrupted
        if (dbLoaded && createError instanceof Error &&
          createError.message.includes('malformed')) {
          console.warn(`LocalDB: Database corrupted, recreating from scratch...`);

          // backup corrupted db
          try {
            await fs.rename(this.dbPath, `${this.dbPath}.corrupted.${Date.now()}`);
          } catch (backupError) {
            console.error(`LocalDB: Failed to backup corrupted db:`, backupError);
          }

          // create fresh database
          this.db = new this.sql.Database();
          await this.createTables();
          console.log(`LocalDB: Fresh database created successfully`);
        } else {
          throw createError;
        }
      }
      } catch (createError) {
        // if table creation fails on existing db, it's likely corrupted
        if (dbLoaded && createError instanceof Error &&
            createError.message.includes('malformed')) {
          console.warn(`LocalDB: Database corrupted, recreating from scratch...`);

          // backup corrupted db
          try {
            await fs.rename(this.dbPath, `${this.dbPath}.corrupted.${Date.now()}`);
          } catch (backupError) {
            console.error(`LocalDB: Failed to backup corrupted db:`, backupError);
          }

          // create fresh database
          this.db = new this.sql.Database();
          await this.createTables();
          console.log(`LocalDB: Fresh database created successfully`);
        } else {
          throw createError;
        }
      }

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
				nudge_responses TEXT DEFAULT '{}',
				nudge_responses TEXT DEFAULT '{}',
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				revealed INTEGER NOT NULL DEFAULT 0
			)
		`);

    // migrate existing ballots table to add nudge_responses column
    // check if column exists first to avoid errors on repeated migrations
    try {
      const tableInfo = this.db.exec("PRAGMA table_info(ballots)");
      const hasNudgeColumn = tableInfo.length > 0 &&
        tableInfo[0].values.some((row: any[]) => row[1] === 'nudge_responses');

      if (!hasNudgeColumn) {
        this.db.run(`
          ALTER TABLE ballots
          ADD COLUMN nudge_responses TEXT DEFAULT '{}'
        `);
        console.log('LocalDB: Added nudge_responses column to ballots table');
      }
    } catch (error) {
      // column might not exist yet, which is fine - it will be created with CREATE TABLE
      console.log('LocalDB: nudge_responses column migration check skipped:', error);
    }

    // migrate existing ballots table to add nudge_responses column
    // check if column exists first to avoid errors on repeated migrations
    try {
      const tableInfo = this.db.exec("PRAGMA table_info(ballots)");
      const hasNudgeColumn = tableInfo.length > 0 &&
        tableInfo[0].values.some((row: any[]) => row[1] === 'nudge_responses');

      if (!hasNudgeColumn) {
        this.db.run(`
          ALTER TABLE ballots
          ADD COLUMN nudge_responses TEXT DEFAULT '{}'
        `);
        console.log('LocalDB: Added nudge_responses column to ballots table');
      }
    } catch (error) {
      // column might not exist yet, which is fine - it will be created with CREATE TABLE
      console.log('LocalDB: nudge_responses column migration check skipped:', error);
    }

    // pr_state table - tracks review workflow phases
    // phase 'blinded': reviewers submit anonymous ballots, author info hidden
    // phase 'revealed': ballots are revealed, discussion phase begins
    // this separation supports double-blind review and reduces anchoring bias
    // ballot_threshold: minimum number of ballots required before reveal is allowed
    // github_comment_url: url of posted ballot summary comment on github pr
    // github_posted_at: timestamp when ballot summary was posted to github
    // github_comment_url: url of posted ballot summary comment on github pr
    // github_posted_at: timestamp when ballot summary was posted to github
    this.db.run(`
			CREATE TABLE IF NOT EXISTS pr_state (
				pr_reference TEXT PRIMARY KEY,
				phase TEXT NOT NULL CHECK (phase IN ('blinded', 'revealed')),
				ballot_threshold INTEGER NOT NULL DEFAULT 3,
				first_pass_deadline DATETIME,
				github_comment_url TEXT,
				github_posted_at DATETIME,
				github_comment_url TEXT,
				github_posted_at DATETIME,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

    // index_metadata table - tracks indexing state for incremental updates
    // stores key-value pairs for last indexed commit hash, file modification times, index version
    this.db.run(`
			CREATE TABLE IF NOT EXISTS index_metadata (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

    // evidence_entries table - tracks evidence blocks for PRs
    // stores structured evidence data for tests, benchmarks, specs, and risk assessments
    // supports validation and tracking of evidence completeness across PR lifecycle
    this.db.run(`
			CREATE TABLE IF NOT EXISTS evidence_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_reference TEXT NOT NULL,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				tests_status TEXT NOT NULL CHECK (tests_status IN ('complete', 'in_progress', 'n/a')),
				tests_details TEXT NOT NULL DEFAULT '',
				benchmarks_status TEXT NOT NULL CHECK (benchmarks_status IN ('complete', 'in_progress', 'n/a')),
				benchmarks_details TEXT NOT NULL DEFAULT '',
				spec_status TEXT NOT NULL CHECK (spec_status IN ('complete', 'in_progress', 'n/a')),
				spec_references TEXT NOT NULL DEFAULT '',
				risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
				identified_risks TEXT NOT NULL DEFAULT '',
				rollback_plan TEXT NOT NULL DEFAULT ''
			)
		`);

    // search_history table - tracks user search queries for context discovery
    // stores search history to enable quick re-execution of previous searches
    // supports search patterns analysis and helps users navigate their workflow
    this.db.run(`
			CREATE TABLE IF NOT EXISTS search_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				query TEXT NOT NULL,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

    // pr_outcomes table - tracks pr outcomes for calibration feedback
    // stores detected and user-confirmed outcomes to enable confidence calibration
    // outcome_type: merged_clean (no issues), bug_found (fix needed), reverted (rollback), followup_required (additional work)
    // detected_auto: true if detected by automatic pattern matching
    // user_confirmed: true if user manually confirmed or overrode the outcome
    // detection_details: JSON object with commits, keywords, confidence score
    this.db.run(`
			CREATE TABLE IF NOT EXISTS pr_outcomes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_id TEXT NOT NULL,
				outcome_type TEXT NOT NULL CHECK (outcome_type IN ('merged_clean', 'bug_found', 'reverted', 'followup_required')),
				detected_auto INTEGER NOT NULL DEFAULT 0,
				user_confirmed INTEGER NOT NULL DEFAULT 0,
				detection_details TEXT,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (pr_id) REFERENCES pr_state(pr_reference)
			)
		`);

    // decision_schemes table - tracks which social judgment scheme was used for each pr
    // supports meta-decision tracking and reflection on decision-making patterns
    // helps teams understand which decision rules work best for different contexts
    this.db.run(`
			CREATE TABLE IF NOT EXISTS decision_schemes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_id TEXT NOT NULL,
				scheme_type TEXT NOT NULL CHECK (scheme_type IN ('consensus', 'truth_wins', 'majority', 'expert_veto', 'unanimous', 'custom')),
				rationale TEXT NOT NULL,
				custom_scheme_name TEXT,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (pr_id) REFERENCES pr_state(pr_reference)
			)
		`);

    // retrospectives table - tracks post-mortem reflections on pr outcomes
    // supports continuous improvement and bias awareness
    // helps teams learn from mistakes and adjust review processes
    this.db.run(`
			CREATE TABLE IF NOT EXISTS retrospectives (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_id TEXT NOT NULL,
				trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'auto_bug_found', 'auto_revert')),
				what_went_wrong TEXT NOT NULL,
				what_to_improve TEXT NOT NULL,
				bias_patterns TEXT NOT NULL DEFAULT '[]',
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (pr_id) REFERENCES pr_state(pr_reference)
			)
		`);

    // evidence_entries table - tracks evidence blocks for PRs
    // stores structured evidence data for tests, benchmarks, specs, and risk assessments
    // supports validation and tracking of evidence completeness across PR lifecycle
    this.db.run(`
			CREATE TABLE IF NOT EXISTS evidence_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_reference TEXT NOT NULL,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				tests_status TEXT NOT NULL CHECK (tests_status IN ('complete', 'in_progress', 'n/a')),
				tests_details TEXT NOT NULL DEFAULT '',
				benchmarks_status TEXT NOT NULL CHECK (benchmarks_status IN ('complete', 'in_progress', 'n/a')),
				benchmarks_details TEXT NOT NULL DEFAULT '',
				spec_status TEXT NOT NULL CHECK (spec_status IN ('complete', 'in_progress', 'n/a')),
				spec_references TEXT NOT NULL DEFAULT '',
				risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
				identified_risks TEXT NOT NULL DEFAULT '',
				rollback_plan TEXT NOT NULL DEFAULT ''
			)
		`);

    // search_history table - tracks user search queries for context discovery
    // stores search history to enable quick re-execution of previous searches
    // supports search patterns analysis and helps users navigate their workflow
    this.db.run(`
			CREATE TABLE IF NOT EXISTS search_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				query TEXT NOT NULL,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

    // pr_outcomes table - tracks pr outcomes for calibration feedback
    // stores detected and user-confirmed outcomes to enable confidence calibration
    // outcome_type: merged_clean (no issues), bug_found (fix needed), reverted (rollback), followup_required (additional work)
    // detected_auto: true if detected by automatic pattern matching
    // user_confirmed: true if user manually confirmed or overrode the outcome
    // detection_details: JSON object with commits, keywords, confidence score
    this.db.run(`
			CREATE TABLE IF NOT EXISTS pr_outcomes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_id TEXT NOT NULL,
				outcome_type TEXT NOT NULL CHECK (outcome_type IN ('merged_clean', 'bug_found', 'reverted', 'followup_required')),
				detected_auto INTEGER NOT NULL DEFAULT 0,
				user_confirmed INTEGER NOT NULL DEFAULT 0,
				detection_details TEXT,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (pr_id) REFERENCES pr_state(pr_reference)
			)
		`);

    // decision_schemes table - tracks which social judgment scheme was used for each pr
    // supports meta-decision tracking and reflection on decision-making patterns
    // helps teams understand which decision rules work best for different contexts
    this.db.run(`
			CREATE TABLE IF NOT EXISTS decision_schemes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_id TEXT NOT NULL,
				scheme_type TEXT NOT NULL CHECK (scheme_type IN ('consensus', 'truth_wins', 'majority', 'expert_veto', 'unanimous', 'custom')),
				rationale TEXT NOT NULL,
				custom_scheme_name TEXT,
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (pr_id) REFERENCES pr_state(pr_reference)
			)
		`);

    // retrospectives table - tracks post-mortem reflections on pr outcomes
    // supports continuous improvement and bias awareness
    // helps teams learn from mistakes and adjust review processes
    this.db.run(`
			CREATE TABLE IF NOT EXISTS retrospectives (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				pr_id TEXT NOT NULL,
				trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'auto_bug_found', 'auto_revert')),
				what_went_wrong TEXT NOT NULL,
				what_to_improve TEXT NOT NULL,
				bias_patterns TEXT NOT NULL DEFAULT '[]',
				timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (pr_id) REFERENCES pr_state(pr_reference)
			)
		`);

    // create indexes for better search performance
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_context_type ON context_entries(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_context_path ON context_entries(path)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ballots_pr ON ballots(pr_reference)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_pr_state_phase ON pr_state(phase)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_evidence_pr ON evidence_entries(pr_reference)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_search_history_ts ON search_history(timestamp DESC)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_pr_outcomes_pr ON pr_outcomes(pr_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_decision_schemes_pr ON decision_schemes(pr_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_retrospectives_pr ON retrospectives(pr_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_retrospectives_ts ON retrospectives(timestamp DESC)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_evidence_pr ON evidence_entries(pr_reference)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_search_history_ts ON search_history(timestamp DESC)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_pr_outcomes_pr ON pr_outcomes(pr_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_decision_schemes_pr ON decision_schemes(pr_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_retrospectives_pr ON retrospectives(pr_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_retrospectives_ts ON retrospectives(timestamp DESC)`);
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

    // remove order by clause - ranking happens in indexer using bm25
    // increase limit since ranking happens after retrieval
    sql += ' LIMIT 100';

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
			INSERT INTO ballots (pr_reference, decision, confidence, rationale, author_metadata, nudge_responses, revealed)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			INSERT INTO ballots (pr_reference, decision, confidence, rationale, author_metadata, nudge_responses, revealed)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);

    stmt.bind([
      ballot.pr_reference,
      ballot.decision,
      ballot.confidence,
      ballot.rationale,
      ballot.author_metadata,
      ballot.nudge_responses || '{}',
      ballot.nudge_responses || '{}',
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
    this.db.run('DELETE FROM index_metadata');
    this.db.run('DELETE FROM evidence_entries');
    this.db.run('DELETE FROM search_history');
    this.db.run('DELETE FROM pr_outcomes');
    this.db.run('DELETE FROM decision_schemes');
    this.db.run('DELETE FROM retrospectives');
    this.db.run('DELETE FROM evidence_entries');
    this.db.run('DELETE FROM search_history');
    this.db.run('DELETE FROM pr_outcomes');
    this.db.run('DELETE FROM decision_schemes');
    this.db.run('DELETE FROM retrospectives');

    await this.persistToFile();
  }

  /**
   * Gets a metadata value from the index_metadata table.
   *
   * Used to track indexing state such as last indexed commit hash,
   * file modification times, and index version for incremental updates.
   *
   * @param key - The metadata key to retrieve
   * @returns Promise resolving to the value or null if not found
   */
  async getIndexMetadata(key: string): Promise<string | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT value FROM index_metadata
			WHERE key = ?
		`);

    stmt.bind([key]);

    let value: string | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { value: string };
      value = row.value;
    }

    stmt.free();
    return value;
  }

  /**
   * Sets a metadata value in the index_metadata table.
   *
   * Updates existing value or inserts new one if not present.
   * Automatically updates the updated_at timestamp.
   *
   * @param key - The metadata key to set
   * @param value - The value to store
   * @returns Promise that resolves when the value is set
   */
  async setIndexMetadata(key: string, value: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // implement upsert: try update first, then insert if needed
    const updateStmt = this.db.prepare(`
			UPDATE index_metadata
			SET value = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE key = ?
		`);
    updateStmt.bind([value, key]);
    updateStmt.step();
    updateStmt.free();

    // check if update affected any rows
    const changes = this.db.exec('SELECT changes() as count')[0].values[0][0] as number;

    // if no rows were updated, insert new row
    if (changes === 0) {
      const insertStmt = this.db.prepare(`
				INSERT INTO index_metadata (key, value, updated_at)
				VALUES (?, ?, CURRENT_TIMESTAMP)
			`);
      insertStmt.bind([key, value]);
      insertStmt.step();
      insertStmt.free();
    }

    await this.persistToFile();
  }

  /**
   * Gets the last indexed commit hash from metadata.
   *
   * Used for incremental git indexing to only process new commits
   * since the last indexing operation.
   *
   * @returns Promise resolving to the commit hash or null if not found
   */
  async getLastIndexedCommit(): Promise<string | null> {
    return this.getIndexMetadata('last_indexed_commit');
  }

  /**
   * Sets the last indexed commit hash in metadata.
   *
   * Called after successfully indexing commits to track the latest
   * indexed commit for future incremental updates.
   *
   * @param commitHash - The git commit hash to store
   * @returns Promise that resolves when the hash is stored
   */
  async setLastIndexedCommit(commitHash: string): Promise<void> {
    return this.setIndexMetadata('last_indexed_commit', commitHash);
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

  /**
   * Retrieves recent PRs that the user has reviewed.
   *
   * Returns PRs ordered by most recent activity (ballot submission or phase update).
   * Includes PR reference, phase, ballot count, and last activity timestamp.
   * Useful for quick PR switching and workflow continuity.
   *
   * @param limit - Maximum number of PRs to return (default: 10)
   * @returns Promise resolving to array of recent PR summaries
   */
  async getRecentPRs(limit: number = 10): Promise<Array<{
    prReference: string;
    phase: string | null;
    ballotCount: number;
    lastActivity: string;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
      SELECT
        b.pr_reference,
        p.phase,
        COUNT(b.id) as ballot_count,
        MAX(b.created_at, p.updated_at) as last_activity
      FROM ballots b
      LEFT JOIN pr_state p ON b.pr_reference = p.pr_reference
      GROUP BY b.pr_reference
      ORDER BY last_activity DESC
      LIMIT ?
    `);

    stmt.bind([limit]);

    const results: Array<{
      prReference: string;
      phase: string | null;
      ballotCount: number;
      lastActivity: string;
    }> = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        pr_reference: string;
        phase: string | null;
        ballot_count: number;
        last_activity: string;
      };

      results.push({
        prReference: row.pr_reference,
        phase: row.phase,
        ballotCount: row.ballot_count,
        lastActivity: row.last_activity,
      });
    }

    stmt.free();
    return results;
  }

  /**
   * Saves an evidence entry to the database.
   *
   * Evidence entries track structured data for PR reviews including test results,
   * benchmarks, specifications, and risk assessments. This supports evidence-based
   * review practices and helps teams maintain consistent documentation standards.
   *
   * @param evidence - The evidence entry to save (without id, timestamp auto-generated)
   * @returns Promise resolving to the ID of the inserted entry
   * @throws Error if database not initialized or validation fails
   */
  async saveEvidence(evidence: Omit<EvidenceEntry, 'id' | 'timestamp'>): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			INSERT INTO evidence_entries (
				pr_reference,
				tests_status,
				tests_details,
				benchmarks_status,
				benchmarks_details,
				spec_status,
				spec_references,
				risk_level,
				identified_risks,
				rollback_plan
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

    stmt.bind([
      evidence.pr_reference,
      evidence.tests_status,
      evidence.tests_details,
      evidence.benchmarks_status,
      evidence.benchmarks_details,
      evidence.spec_status,
      evidence.spec_references,
      evidence.risk_level,
      evidence.identified_risks,
      evidence.rollback_plan,
    ]);

    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
  }

  /**
   * Retrieves all evidence entries for a specific PR.
   *
   * Used to display evidence history and track documentation completeness
   * throughout the review lifecycle. Evidence entries are ordered by timestamp
   * to show the progression of documentation.
   *
   * @param prReference - The PR identifier
   * @returns Promise resolving to array of evidence entries
   * @throws Error if database not initialized
   */
  async getEvidenceForPR(prReference: string): Promise<EvidenceEntry[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT * FROM evidence_entries
			WHERE pr_reference = ?
			ORDER BY timestamp DESC
		`);

    stmt.bind([prReference]);

    const rows: EvidenceEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        id: row.id,
        pr_reference: row.pr_reference,
        timestamp: row.timestamp,
        tests_status: row.tests_status,
        tests_details: row.tests_details,
        benchmarks_status: row.benchmarks_status,
        benchmarks_details: row.benchmarks_details,
        spec_status: row.spec_status,
        spec_references: row.spec_references,
        risk_level: row.risk_level,
        identified_risks: row.identified_risks,
        rollback_plan: row.rollback_plan,
      });
    }

    stmt.free();
    return rows;
  }

  /**
   * Retrieves all evidence entries from the database.
   *
   * Used for analytics, reporting, and cross-PR evidence analysis.
   * Returns all entries ordered by timestamp descending to show most recent first.
   *
   * @returns Promise resolving to array of all evidence entries
   * @throws Error if database not initialized
   */
  async getAllEvidence(): Promise<EvidenceEntry[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT * FROM evidence_entries
			ORDER BY timestamp DESC
		`);

    const rows: EvidenceEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        id: row.id,
        pr_reference: row.pr_reference,
        timestamp: row.timestamp,
        tests_status: row.tests_status,
        tests_details: row.tests_details,
        benchmarks_status: row.benchmarks_status,
        benchmarks_details: row.benchmarks_details,
        spec_status: row.spec_status,
        spec_references: row.spec_references,
        risk_level: row.risk_level,
        identified_risks: row.identified_risks,
        rollback_plan: row.rollback_plan,
      });
    }

    stmt.free();
    return rows;
  }

  /**
   * Adds a search query to the search history.
   *
   * Stores user search queries for quick re-execution and pattern analysis.
   * Helps users navigate their workflow by tracking commonly searched terms.
   *
   * @param query - The search query string
   * @param timestamp - Optional timestamp in ISO 8601 format (defaults to current time)
   * @returns Promise resolving to the ID of the inserted entry
   * @throws Error if database not initialized
   */
  async addSearchQuery(query: string, timestamp?: string): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // use provided timestamp or generate current timestamp with millisecond precision
    const ts = timestamp || new Date().toISOString();

    const stmt = this.db.prepare(`
			INSERT INTO search_history (query, timestamp)
			VALUES (?, ?)
		`);

    stmt.bind([query, ts]);
    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
  }

  /**
   * Retrieves recent search queries from history.
   *
   * Returns the most recent search queries ordered by timestamp descending.
   * Used to populate the Recent Searches tree view section.
   *
   * @param limit - Maximum number of queries to return (default: 10)
   * @returns Promise resolving to array of search history entries
   * @throws Error if database not initialized
   */
  async getRecentSearches(limit: number = 10): Promise<SearchHistoryEntry[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT * FROM search_history
			ORDER BY timestamp DESC
			LIMIT ?
		`);

    stmt.bind([limit]);

    const rows: SearchHistoryEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        id: row.id,
        query: row.query,
        timestamp: row.timestamp,
      });
    }

    stmt.free();
    return rows;
  }

  /**
   * Marks ballots as posted to GitHub with comment URL and timestamp.
   *
   * Updates the pr_state table to record that ballot summary has been
   * posted to GitHub PR as a comment. Used to prevent duplicate posts
   * and track integration with GitHub workflow.
   *
   * @param prReference - The PR identifier
   * @param commentUrl - GitHub comment HTML URL
   * @returns Promise that resolves when metadata is stored
   * @throws Error if database not initialized
   */
  async markBallotsPostedToGitHub(prReference: string, commentUrl: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			UPDATE pr_state
			SET github_comment_url = ?,
				github_posted_at = CURRENT_TIMESTAMP,
				updated_at = CURRENT_TIMESTAMP
			WHERE pr_reference = ?
		`);

    stmt.bind([commentUrl, prReference]);
    stmt.step();
    stmt.free();

    await this.persistToFile();
  }

  /**
   * Checks if ballots have already been posted to GitHub.
   *
   * Used to prevent duplicate ballot summary posts to the same PR.
   * Returns true if a GitHub comment URL has been recorded for this PR.
   *
   * @param prReference - The PR identifier
   * @returns Promise resolving to true if already posted
   * @throws Error if database not initialized
   */
  async isPostedToGitHub(prReference: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT github_comment_url FROM pr_state
			WHERE pr_reference = ?
		`);

    stmt.bind([prReference]);

    let posted = false;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { github_comment_url: string | null };
      posted = row.github_comment_url !== null && row.github_comment_url !== '';
    }

    stmt.free();
    return posted;
  }

  /**
   * Records a PR outcome for calibration tracking.
   *
   * Stores outcome data including auto-detection status, user confirmation,
   * and detection details. Used to track PR results and enable confidence
   * calibration feedback over time.
   *
   * @param prId - The PR identifier
   * @param outcomeType - Type of outcome (merged_clean, bug_found, reverted, followup_required)
   * @param detectedAuto - Whether outcome was auto-detected
   * @param detectionDetails - JSON object with detection information
   * @returns Promise resolving to the ID of the inserted entry
   * @throws Error if database not initialized
   */
  async recordOutcome(
    prId: string,
    outcomeType: 'merged_clean' | 'bug_found' | 'reverted' | 'followup_required',
    detectedAuto: boolean,
    detectionDetails?: Record<string, any>
  ): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			INSERT INTO pr_outcomes (pr_id, outcome_type, detected_auto, user_confirmed, detection_details)
			VALUES (?, ?, ?, ?, ?)
		`);

    const userConfirmed = !detectedAuto; // if not auto-detected, it's user-confirmed
    const detailsJson = detectionDetails ? JSON.stringify(detectionDetails) : null;

    stmt.bind([prId, outcomeType, detectedAuto ? 1 : 0, userConfirmed ? 1 : 0, detailsJson]);
    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
  }

  /**
   * Gets all outcomes for a specific PR.
   *
   * Returns all outcome records for the given PR, ordered by timestamp descending.
   * Used to display outcome history and track corrections/updates.
   *
   * @param prId - The PR identifier
   * @returns Promise resolving to array of PR outcomes
   * @throws Error if database not initialized
   */
  async getOutcomesForPR(prId: string): Promise<PROutcome[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT * FROM pr_outcomes
			WHERE pr_id = ?
			ORDER BY timestamp DESC
		`);

    stmt.bind([prId]);

    const rows: PROutcome[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        id: row.id,
        pr_id: row.pr_id,
        outcome_type: row.outcome_type,
        detected_auto: Boolean(row.detected_auto),
        user_confirmed: Boolean(row.user_confirmed),
        detection_details: row.detection_details || '{}',
        timestamp: row.timestamp,
      });
    }

    stmt.free();
    return rows;
  }

  /**
   * Gets calibration data for the current user.
   *
   * Joins ballots with PR outcomes to calculate confidence vs accuracy metrics.
   * Returns data points showing user's confidence level and whether their
   * decision aligned with the actual outcome.
   *
   * Calibration logic:
   * - Approve + merged_clean = success
   * - Reject + (bug_found | reverted) = success
   * - Neutral always counted as partial success (0.5)
   * - Misalignments = failure
   *
   * @returns Promise resolving to array of calibration data points
   * @throws Error if database not initialized
   */
  async getUserCalibrationData(): Promise<CalibrationDataPoint[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT
				b.pr_reference,
				b.confidence,
				b.decision,
				o.outcome_type
			FROM ballots b
			INNER JOIN pr_outcomes o ON b.pr_reference = o.pr_id
			WHERE o.user_confirmed = 1
			ORDER BY b.created_at DESC
		`);

    const rows: CalibrationDataPoint[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;

      // calculate outcome success based on decision alignment
      let outcomeSuccess = false;
      if (row.decision === 'approve') {
        outcomeSuccess = row.outcome_type === 'merged_clean';
      } else if (row.decision === 'reject') {
        outcomeSuccess = row.outcome_type === 'bug_found' || row.outcome_type === 'reverted';
      } else {
        // neutral decisions are ambiguous and should not be included in calibration
        // neutral represents abstention, not a prediction that can be validated
        continue;
      }

      rows.push({
        pr_reference: row.pr_reference,
        confidence: row.confidence,
        decision: row.decision,
        outcome_type: row.outcome_type,
        outcome_success: outcomeSuccess,
      });
    }

    stmt.free();
    return rows;
  }

  /**
   * Confirms or updates a PR outcome.
   *
   * Allows users to manually confirm auto-detected outcomes or override them.
   * Updates the user_confirmed flag and optionally changes the outcome type.
   *
   * @param outcomeId - The outcome record ID
   * @param confirmed - Whether the outcome is confirmed
   * @param newOutcomeType - Optional new outcome type if overriding
   * @returns Promise that resolves when update is complete
   * @throws Error if database not initialized
   */
  async confirmOutcome(
    outcomeId: number,
    confirmed: boolean,
    newOutcomeType?: 'merged_clean' | 'bug_found' | 'reverted' | 'followup_required'
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let sql = `
			UPDATE pr_outcomes
			SET user_confirmed = ?
		`;
    const params: any[] = [confirmed ? 1 : 0];

    if (newOutcomeType) {
      sql += ', outcome_type = ?';
      params.push(newOutcomeType);
    }

    sql += ' WHERE id = ?';
    params.push(outcomeId);

    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();

    await this.persistToFile();
  }

  /**
   * Records a decision scheme for a pr.
   *
   * Stores which social judgment scheme was used to make the final decision.
   * This enables reflection on which decision rules work best for different contexts.
   *
   * @param prId - The PR identifier
   * @param schemeType - The type of decision scheme used
   * @param rationale - Explanation of why this scheme was chosen
   * @param customName - Optional custom scheme name if type is 'custom'
   * @returns Promise resolving to the ID of the inserted entry
   * @throws Error if database not initialized
   */
  async recordDecisionScheme(
    prId: string,
    schemeType: string,
    rationale: string,
    customName?: string
  ): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			INSERT INTO decision_schemes (pr_id, scheme_type, rationale, custom_scheme_name)
			VALUES (?, ?, ?, ?)
		`);

    stmt.bind([prId, schemeType, rationale, customName || null]);
    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
  }

  /**
   * Gets the decision scheme for a pr.
   *
   * Retrieves the recorded decision scheme if one exists.
   *
   * @param prId - The PR identifier
   * @returns Promise resolving to the decision scheme entry or null
   * @throws Error if database not initialized
   */
  async getDecisionScheme(prId: string): Promise<DecisionSchemeEntry | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			SELECT * FROM decision_schemes
			WHERE pr_id = ?
			ORDER BY timestamp DESC
			LIMIT 1
		`);

    stmt.bind([prId]);

    let entry: DecisionSchemeEntry | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      entry = {
        id: row.id,
        pr_id: row.pr_id,
        scheme_type: row.scheme_type,
        rationale: row.rationale,
        custom_scheme_name: row.custom_scheme_name,
        timestamp: row.timestamp,
      };
    }

    stmt.free();
    return entry;
  }

  /**
   * Records a retrospective for a pr.
   *
   * Stores post-mortem reflections on what went wrong and how to improve.
   * Supports continuous learning and bias awareness.
   *
   * @param prId - The PR identifier
   * @param triggerType - How the retrospective was triggered
   * @param data - Retrospective data including what went wrong and improvements
   * @returns Promise resolving to the ID of the inserted entry
   * @throws Error if database not initialized
   */
  async recordRetrospective(
    prId: string,
    triggerType: string,
    data: {
      what_went_wrong: string;
      what_to_improve: string;
      bias_patterns: string[];
    }
  ): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
			INSERT INTO retrospectives (pr_id, trigger_type, what_went_wrong, what_to_improve, bias_patterns)
			VALUES (?, ?, ?, ?, ?)
		`);

    stmt.bind([
      prId,
      triggerType,
      data.what_went_wrong,
      data.what_to_improve,
      JSON.stringify(data.bias_patterns),
    ]);
    stmt.step();
    const lastInsertId = this.db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    stmt.free();

    await this.persistToFile();
    return lastInsertId;
  }

  /**
   * Gets retrospectives with optional filters.
   *
   * Retrieves retrospective entries filtered by date range, pr, or trigger type.
   * Returns entries ordered by timestamp descending (most recent first).
   *
   * @param filters - Optional filters for date range, pr id, or trigger type
   * @returns Promise resolving to array of retrospective entries
   * @throws Error if database not initialized
   */
  async getRetrospectives(filters?: RetrospectiveFilters): Promise<RetrospectiveEntry[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let sql = 'SELECT * FROM retrospectives WHERE 1=1';
    const params: any[] = [];

    if (filters?.pr_id) {
      sql += ' AND pr_id = ?';
      params.push(filters.pr_id);
    }

    if (filters?.trigger_type) {
      sql += ' AND trigger_type = ?';
      params.push(filters.trigger_type);
    }

    if (filters?.start_date) {
      sql += ' AND timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters?.end_date) {
      sql += ' AND timestamp <= ?';
      params.push(filters.end_date);
    }

    sql += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }

    const rows: RetrospectiveEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({
        id: row.id,
        pr_id: row.pr_id,
        trigger_type: row.trigger_type,
        what_went_wrong: row.what_went_wrong,
        what_to_improve: row.what_to_improve,
        bias_patterns: row.bias_patterns,
        timestamp: row.timestamp,
      });
    }

    stmt.free();
    return rows;
  }

  /**
   * Gets reflection analytics aggregated from historical data.
   *
   * Analyzes decision schemes, retrospectives, and outcomes to generate
   * team-level insights about decision patterns and potential biases.
   *
   * @returns Promise resolving to reflection analytics
   * @throws Error if database not initialized
   */
  async getReflectionAnalytics(): Promise<ReflectionAnalytics> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // get scheme distribution
    const schemeStmt = this.db.prepare(`
			SELECT scheme_type, COUNT(*) as count
			FROM decision_schemes
			GROUP BY scheme_type
		`);

    const schemeDistribution: Record<string, number> = {};
    while (schemeStmt.step()) {
      const row = schemeStmt.getAsObject() as { scheme_type: string; count: number };
      schemeDistribution[row.scheme_type] = row.count;
    }
    schemeStmt.free();

    // get total retrospectives
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM retrospectives');
    countStmt.step();
    const countRow = countStmt.getAsObject() as { count: number };
    const totalRetrospectives = countRow.count;
    countStmt.free();

    // get bias frequency
    const biasStmt = this.db.prepare('SELECT bias_patterns FROM retrospectives');
    const biasFrequency: Record<string, number> = {};

    while (biasStmt.step()) {
      const row = biasStmt.getAsObject() as { bias_patterns: string };
      try {
        const patterns = JSON.parse(row.bias_patterns);
        if (Array.isArray(patterns)) {
          patterns.forEach((pattern: string) => {
            biasFrequency[pattern] = (biasFrequency[pattern] || 0) + 1;
          });
        }
      } catch {
        // skip invalid json
      }
    }
    biasStmt.free();

    return {
      scheme_distribution: schemeDistribution as any,
      total_retrospectives: totalRetrospectives,
      bias_frequency: biasFrequency as any,
      insights: [], // insights will be generated by ReflectionService
    };
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
