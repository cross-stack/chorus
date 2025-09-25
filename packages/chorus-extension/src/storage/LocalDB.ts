import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { ContextItem, EvidenceItem, QuietBallot } from '../types';

export class LocalDB {
  private db: Database.Database;

  constructor(private extensionPath: string) {
    const dbPath = path.join(extensionPath, 'chorus.db');

    // Ensure directory exists
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Context items table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        path TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        author TEXT,
        score REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Evidence items table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        file_path TEXT,
        line_number INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Quiet ballots table - locally stored only
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quiet_ballots (
        id TEXT PRIMARY KEY,
        pr_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        rationale TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        revealed BOOLEAN DEFAULT 0,
        author_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_context_type ON context_items(type);
      CREATE INDEX IF NOT EXISTS idx_context_timestamp ON context_items(timestamp);
      CREATE INDEX IF NOT EXISTS idx_context_content ON context_items(content);
      CREATE INDEX IF NOT EXISTS idx_ballots_pr ON quiet_ballots(pr_id);
    `);
  }

  // Context Items
  insertContextItem(item: ContextItem): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO context_items
      (id, type, title, content, path, timestamp, author, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      item.id,
      item.type,
      item.title,
      item.content,
      item.path,
      item.timestamp.toISOString(),
      item.author,
      item.score
    );
  }

  getContextItems(limit: number = 100): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items
      ORDER BY score DESC, timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(this.mapContextItemRow);
  }

  searchContextItems(query: string, limit: number = 50): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items
      WHERE content LIKE ? OR title LIKE ?
      ORDER BY score DESC, timestamp DESC
      LIMIT ?
    `);

    const searchTerm = `%${query}%`;
    const rows = stmt.all(searchTerm, searchTerm, limit) as any[];
    return rows.map(this.mapContextItemRow);
  }

  // Evidence Items
  insertEvidenceItem(item: EvidenceItem): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO evidence_items
      (id, type, title, content, status, file_path, line_number)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      item.id,
      item.type,
      item.title,
      item.content,
      item.status,
      item.filePath || null,
      item.lineNumber || null
    );
  }

  getEvidenceItems(): EvidenceItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM evidence_items
      ORDER BY created_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(this.mapEvidenceItemRow);
  }

  // Quiet Ballots
  insertQuietBallot(ballot: QuietBallot): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO quiet_ballots
      (id, pr_id, decision, confidence, rationale, timestamp, revealed, author_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      ballot.id,
      ballot.prId,
      ballot.decision,
      ballot.confidence,
      ballot.rationale,
      ballot.timestamp.toISOString(),
      ballot.revealed ? 1 : 0,
      ballot.authorId || null
    );
  }

  getQuietBallot(prId: string): QuietBallot | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM quiet_ballots
      WHERE pr_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(prId) as any;
    return row ? this.mapQuietBallotRow(row) : undefined;
  }

  updateBallotRevealStatus(ballotId: string, revealed: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE quiet_ballots
      SET revealed = ?
      WHERE id = ?
    `);

    stmt.run(revealed ? 1 : 0, ballotId);
  }

  // Row mapping helpers
  private mapContextItemRow(row: any): ContextItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      path: row.path,
      timestamp: new Date(row.timestamp),
      author: row.author,
      score: row.score,
    };
  }

  private mapEvidenceItemRow(row: any): EvidenceItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      status: row.status,
      filePath: row.file_path,
      lineNumber: row.line_number,
    };
  }

  private mapQuietBallotRow(row: any): QuietBallot {
    return {
      id: row.id,
      prId: row.pr_id,
      decision: row.decision,
      confidence: row.confidence,
      rationale: row.rationale,
      timestamp: new Date(row.timestamp),
      revealed: Boolean(row.revealed),
      authorId: row.author_id,
    };
  }

  // Cleanup
  close(): void {
    this.db.close();
  }

  // For testing - clear all data
  clearAllData(): void {
    this.db.exec('DELETE FROM context_items');
    this.db.exec('DELETE FROM evidence_items');
    this.db.exec('DELETE FROM quiet_ballots');
  }
}