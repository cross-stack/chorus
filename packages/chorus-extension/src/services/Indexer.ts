import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextItem } from '../types';
import { LocalDB } from '../storage/LocalDB';

export class Indexer {
  private db: LocalDB;

  constructor(db: LocalDB) {
    this.db = db;
  }

  /**
   * Index git log entries as context items
   * Scans recent commits for context and stores them with BM25-style scoring
   */
  async indexGitHistory(workspaceRoot: string, limit: number = 100): Promise<void> {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Get git log with formatted output
      const gitCommand = `git -C "${workspaceRoot}" log --pretty=format:"%H|%s|%an|%ad|%b" --date=iso --max-count=${limit} --no-merges`;

      const { stdout } = await execAsync(gitCommand);
      const lines = stdout.trim().split('\n').filter((line: string) => line.length > 0);

      for (const line of lines) {
        const [hash, subject, author, date, body] = line.split('|');

        if (!hash || !subject) continue;

        const contextItem: ContextItem = {
          id: `commit-${hash}`,
          type: 'commit',
          title: subject.trim(),
          content: `${subject.trim()}\n\n${body?.trim() || ''}`,
          path: workspaceRoot,
          timestamp: new Date(date),
          author: author,
          score: this.calculateCommitScore(subject, body, new Date(date)),
        };

        this.db.insertContextItem(contextItem);
      }
    } catch (error) {
      console.error('Failed to index git history:', error);
    }
  }

  /**
   * Index markdown documentation files
   * Scans docs/ folder and other common doc locations
   */
  async indexDocumentation(workspaceRoot: string): Promise<void> {
    const docPaths = [
      'docs',
      'doc',
      'documentation',
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'ARCHITECTURE.md',
    ];

    for (const docPath of docPaths) {
      const fullPath = path.join(workspaceRoot, docPath);

      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          await this.indexDirectory(fullPath);
        } else if (stat.isFile() && docPath.endsWith('.md')) {
          await this.indexMarkdownFile(fullPath);
        }
      }
    }
  }

  /**
   * Index changed files to find relevant context
   * Used by CodeLens to suggest related items
   */
  async findRelatedContext(filePath: string, changedLines: string[]): Promise<ContextItem[]> {
    // Extract keywords from changed content
    const keywords = this.extractKeywords(changedLines.join('\n'));

    if (keywords.length === 0) {
      return [];
    }

    // Search for related context using keywords
    const searchQuery = keywords.join(' ');
    const results = this.db.searchContextItems(searchQuery, 10);

    // Re-score based on relevance to current changes
    return results
      .map(item => ({
        ...item,
        score: this.calculateRelevanceScore(item, keywords, filePath),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  private async indexDirectory(dirPath: string): Promise<void> {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively index subdirectories (limit depth to avoid infinite loops)
          if (this.getDirectoryDepth(fullPath) < 5) {
            await this.indexDirectory(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          await this.indexMarkdownFile(fullPath);
        }
      }
    } catch (error) {
      console.error(`Failed to index directory ${dirPath}:`, error);
    }
  }

  private async indexMarkdownFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const title = this.extractMarkdownTitle(content) || path.basename(filePath);
      const stats = fs.statSync(filePath);

      const contextItem: ContextItem = {
        id: `doc-${this.hashString(filePath)}`,
        type: 'doc',
        title,
        content: content.slice(0, 2000), // Truncate for storage efficiency
        path: filePath,
        timestamp: stats.mtime,
        score: this.calculateDocScore(content, title),
      };

      this.db.insertContextItem(contextItem);
    } catch (error) {
      console.error(`Failed to index markdown file ${filePath}:`, error);
    }
  }

  private extractMarkdownTitle(content: string): string | null {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    return titleMatch ? titleMatch[1].trim() : null;
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - remove common words and get meaningful terms
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word))
      .filter(word => !/^\d+$/.test(word)); // Remove pure numbers

    // Return unique keywords, limited to prevent over-matching
    return [...new Set(words)].slice(0, 10);
  }

  private calculateCommitScore(subject: string, body: string, date: Date): number {
    let score = 1.0;

    // Boost score for recent commits
    const daysSinceCommit = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - daysSinceCommit / 365); // Higher score for commits within last year

    // Boost score for detailed commits
    if (body && body.length > 50) {
      score += 0.5;
    }

    // Boost score for fix/bug commits
    if (/\b(fix|bug|issue|error|problem)\b/i.test(subject)) {
      score += 0.3;
    }

    // Boost score for feature commits
    if (/\b(feat|feature|add|implement)\b/i.test(subject)) {
      score += 0.2;
    }

    return score;
  }

  private calculateDocScore(content: string, title: string): number {
    let score = 1.0;

    // Boost score for longer, more detailed docs
    score += Math.min(1.0, content.length / 5000);

    // Boost score for certain doc types
    if (/\b(architecture|design|api|guide|tutorial)\b/i.test(title)) {
      score += 0.5;
    }

    // Boost score for README files
    if (title.toLowerCase().includes('readme')) {
      score += 0.3;
    }

    return score;
  }

  private calculateRelevanceScore(item: ContextItem, keywords: string[], filePath: string): number {
    let score = item.score;

    // Count keyword matches in title and content
    const titleMatches = keywords.filter(keyword =>
      item.title.toLowerCase().includes(keyword)
    ).length;

    const contentMatches = keywords.filter(keyword =>
      item.content.toLowerCase().includes(keyword)
    ).length;

    // Weight title matches higher
    score += titleMatches * 0.5 + contentMatches * 0.2;

    // Boost score if paths are similar
    if (item.path.includes(path.dirname(filePath))) {
      score += 0.3;
    }

    return score;
  }

  private getDirectoryDepth(dirPath: string): number {
    return dirPath.split(path.sep).length;
  }

  private hashString(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString();
  }
}