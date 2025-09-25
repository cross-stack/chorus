import { ContextItem, SearchQuery, BM25Result } from '../types';
import { LocalDB } from '../storage/LocalDB';

export class Search {
  private db: LocalDB;

  constructor(db: LocalDB) {
    this.db = db;
  }

  /**
   * Perform BM25-style search across context items
   * Returns ranked results with matching terms highlighted
   */
  searchContext(query: SearchQuery): BM25Result[] {
    // Get all context items that might match
    let candidates = this.db.getContextItems(1000);

    // Filter by type if specified
    if (query.type) {
      candidates = candidates.filter(item => item.type === query.type);
    }

    // Filter by time range if specified
    if (query.timeRange) {
      candidates = candidates.filter(item =>
        item.timestamp >= query.timeRange!.start &&
        item.timestamp <= query.timeRange!.end
      );
    }

    // Calculate BM25 scores for each candidate
    const results: BM25Result[] = [];

    for (const item of candidates) {
      const bm25Score = this.calculateBM25Score(item, query.terms);

      if (bm25Score.score > 0) {
        results.push(bm25Score);
      }
    }

    // Sort by score descending and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }

  /**
   * Quick text search using database LIKE queries
   * Faster but less sophisticated than BM25
   */
  quickSearch(queryText: string, limit: number = 20): ContextItem[] {
    if (!queryText.trim()) {
      return [];
    }

    return this.db.searchContextItems(queryText.trim(), limit);
  }

  /**
   * Search for similar context items based on content similarity
   * Uses simple keyword overlap for now
   */
  findSimilar(referenceItem: ContextItem, limit: number = 10): ContextItem[] {
    const keywords = this.extractKeywords(referenceItem.content);

    if (keywords.length === 0) {
      return [];
    }

    const searchQuery: SearchQuery = {
      terms: keywords,
      type: referenceItem.type,
    };

    const results = this.searchContext(searchQuery);

    return results
      .filter(result => result.item.id !== referenceItem.id) // Exclude the reference item itself
      .slice(0, limit)
      .map(result => result.item);
  }

  /**
   * Advanced search with multiple filters and scoring
   */
  advancedSearch(options: {
    text?: string;
    type?: ContextItem['type'];
    author?: string;
    dateFrom?: Date;
    dateTo?: Date;
    minScore?: number;
    limit?: number;
  }): ContextItem[] {
    let items = this.db.getContextItems(1000);

    // Apply filters
    if (options.type) {
      items = items.filter(item => item.type === options.type);
    }

    if (options.author) {
      items = items.filter(item =>
        item.author?.toLowerCase().includes(options.author!.toLowerCase())
      );
    }

    if (options.dateFrom) {
      items = items.filter(item => item.timestamp >= options.dateFrom!);
    }

    if (options.dateTo) {
      items = items.filter(item => item.timestamp <= options.dateTo!);
    }

    if (options.minScore !== undefined) {
      items = items.filter(item => item.score >= options.minScore!);
    }

    // Apply text search if provided
    if (options.text) {
      const keywords = this.extractKeywords(options.text);
      const scoredResults = items
        .map(item => ({
          item,
          searchScore: this.calculateTextMatchScore(item, keywords),
        }))
        .filter(result => result.searchScore > 0)
        .sort((a, b) => b.searchScore - a.searchScore)
        .map(result => result.item);

      items = scoredResults;
    }

    return items.slice(0, options.limit || 20);
  }

  /**
   * Get search suggestions based on partial query
   */
  getSuggestions(partialQuery: string): string[] {
    if (partialQuery.length < 2) {
      return [];
    }

    // Get recent search terms from content
    const items = this.db.getContextItems(100);
    const allText = items.map(item => `${item.title} ${item.content}`).join(' ');

    const words = allText
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length >= 3 && word.startsWith(partialQuery.toLowerCase()))
      .filter(word => /^[a-zA-Z0-9_-]+$/.test(word)); // Only alphanumeric words

    // Return unique suggestions, sorted by frequency
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(entry => entry[0]);
  }

  private calculateBM25Score(item: ContextItem, queryTerms: string[]): BM25Result {
    const k1 = 1.2; // Term frequency saturation parameter
    const b = 0.75; // Length normalization parameter

    const itemText = `${item.title} ${item.content}`.toLowerCase();
    const itemWords = itemText.split(/\s+/);
    const itemLength = itemWords.length;

    // Approximate average document length (could be calculated from corpus)
    const avgDocLength = 100;

    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTerms) {
      const termLower = term.toLowerCase();

      // Term frequency in document
      const tf = itemWords.filter(word => word.includes(termLower)).length;

      if (tf > 0) {
        matchedTerms.push(term);

        // Simplified BM25 calculation (without corpus-wide IDF)
        const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (itemLength / avgDocLength)));

        // Boost for title matches
        const titleBoost = item.title.toLowerCase().includes(termLower) ? 1.5 : 1.0;

        score += normalizedTf * titleBoost;
      }
    }

    // Apply item's intrinsic score as additional factor
    score *= (1 + item.score / 10);

    return {
      item,
      score,
      matchedTerms,
    };
  }

  private calculateTextMatchScore(item: ContextItem, keywords: string[]): number {
    const itemText = `${item.title} ${item.content}`.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();

      // Count occurrences
      const regex = new RegExp(keywordLower, 'gi');
      const matches = itemText.match(regex);
      const matchCount = matches ? matches.length : 0;

      if (matchCount > 0) {
        // Title matches weighted higher
        const titleMatches = item.title.toLowerCase().includes(keywordLower);
        score += matchCount * (titleMatches ? 2 : 1);
      }
    }

    return score;
  }

  private extractKeywords(text: string): string[] {
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
      .filter(word => word.length > 2 && !commonWords.has(word))
      .filter(word => !/^\d+$/.test(word)); // Remove pure numbers

    return [...new Set(words)].slice(0, 15);
  }
}