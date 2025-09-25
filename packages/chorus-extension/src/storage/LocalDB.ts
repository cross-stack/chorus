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

export class LocalDB implements vscode.Disposable {
	private db: Database.Database | null = null;
	private readonly dbPath: string;

	constructor(storagePath: string) {
		this.dbPath = path.join(storagePath, 'chorus.db');
	}

	async initialize(): Promise<void> {
		try {
			// Ensure storage directory exists
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

		// Context entries table
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

		// Ballots table
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

		// Create indexes for better search performance
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_context_type ON context_entries(type);
			CREATE INDEX IF NOT EXISTS idx_context_path ON context_entries(path);
			CREATE INDEX IF NOT EXISTS idx_ballots_pr ON ballots(pr_reference);
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

	async revealBallots(prReference: string): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		const stmt = this.db.prepare(`
			UPDATE ballots
			SET revealed = 1
			WHERE pr_reference = ?
		`);

		stmt.run(prReference);
	}

	async clearAllData(): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		this.db.exec('DELETE FROM context_entries');
		this.db.exec('DELETE FROM ballots');
	}

	dispose(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}
