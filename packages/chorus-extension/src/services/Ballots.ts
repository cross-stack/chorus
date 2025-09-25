import { QuietBallot } from '../types';
import { LocalDB } from '../storage/LocalDB';

export interface BallotSubmissionResult {
  success: boolean;
  ballot: QuietBallot;
  message: string;
}

export class Ballots {
  private db: LocalDB;
  private currentBallot?: QuietBallot;

  constructor(db: LocalDB) {
    this.db = db;
  }

  /**
   * Create a new quiet ballot for PR review
   * Stores locally and marks as unrevealed by default
   */
  createQuietBallot(
    prId: string,
    decision: QuietBallot['decision'],
    confidence: QuietBallot['confidence'],
    rationale: string
  ): BallotSubmissionResult {
    // Validate inputs
    if (!prId || !decision || !rationale.trim()) {
      return {
        success: false,
        ballot: {} as QuietBallot,
        message: 'Missing required fields: PR ID, decision, and rationale are required',
      };
    }

    if (confidence < 1 || confidence > 5) {
      return {
        success: false,
        ballot: {} as QuietBallot,
        message: 'Confidence must be between 1 and 5',
      };
    }

    if (rationale.trim().length < 10) {
      return {
        success: false,
        ballot: {} as QuietBallot,
        message: 'Rationale must be at least 10 characters long',
      };
    }

    const ballot: QuietBallot = {
      id: `ballot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prId,
      decision,
      confidence,
      rationale: rationale.trim(),
      timestamp: new Date(),
      revealed: false, // Always start as blind review
      authorId: this.generateAnonymousId(), // Generate anonymous ID for tracking
    };

    try {
      this.db.insertQuietBallot(ballot);
      this.currentBallot = ballot;

      return {
        success: true,
        ballot,
        message: 'First-pass review submitted successfully. Author identity is hidden.',
      };
    } catch (error) {
      return {
        success: false,
        ballot: {} as QuietBallot,
        message: `Failed to save ballot: ${error}`,
      };
    }
  }

  /**
   * Reveal ballot by marking it as revealed
   * This makes author information visible to others
   */
  revealBallot(ballotId: string): BallotSubmissionResult {
    try {
      this.db.updateBallotRevealStatus(ballotId, true);

      // Update current ballot if it matches
      if (this.currentBallot?.id === ballotId) {
        this.currentBallot.revealed = true;
      }

      const updatedBallot = this.getBallot(ballotId);
      if (!updatedBallot) {
        return {
          success: false,
          ballot: {} as QuietBallot,
          message: 'Ballot not found after reveal operation',
        };
      }

      return {
        success: true,
        ballot: updatedBallot,
        message: 'Ballot revealed successfully. Author identity is now visible.',
      };
    } catch (error) {
      return {
        success: false,
        ballot: {} as QuietBallot,
        message: `Failed to reveal ballot: ${error}`,
      };
    }
  }

  /**
   * Get ballot for specific PR
   */
  getBallot(prId: string): QuietBallot | undefined {
    return this.db.getQuietBallot(prId);
  }

  /**
   * Get current ballot state
   */
  getCurrentBallot(): QuietBallot | undefined {
    return this.currentBallot;
  }

  /**
   * Check if first-pass review is active (ballot exists and unrevealed)
   */
  isFirstPassActive(prId: string): boolean {
    const ballot = this.getBallot(prId);
    return ballot ? !ballot.revealed : false;
  }

  /**
   * Validate ballot completeness before submission
   */
  validateBallot(
    decision: string,
    confidence: number,
    rationale: string
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!decision || !['approve', 'reject', 'needs-work'].includes(decision)) {
      errors.push('Decision must be approve, reject, or needs-work');
    }

    if (!confidence || confidence < 1 || confidence > 5) {
      errors.push('Confidence must be between 1 and 5');
    }

    if (!rationale || rationale.trim().length < 10) {
      errors.push('Rationale must be at least 10 characters long');
    }

    // Check for potentially biased language (privacy-preserving check)
    const biasPatterns = [
      /\b(obviously|clearly|simple|trivial|just|easy)\b/i,
      /\b(stupid|dumb|idiotic|ridiculous)\b/i,
    ];

    for (const pattern of biasPatterns) {
      if (pattern.test(rationale)) {
        errors.push('Consider using more objective language in your rationale');
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get ballot statistics (privacy-preserving)
   */
  getBallotStats(): {
    totalBallots: number;
    averageConfidence: number;
    decisionDistribution: Record<string, number>;
  } {
    // Note: This would normally query multiple ballots
    // For now, just return stats for current ballot if exists
    const ballot = this.currentBallot;

    if (!ballot) {
      return {
        totalBallots: 0,
        averageConfidence: 0,
        decisionDistribution: {},
      };
    }

    return {
      totalBallots: 1,
      averageConfidence: ballot.confidence,
      decisionDistribution: {
        [ballot.decision]: 1,
      },
    };
  }

  /**
   * Clear current ballot state
   * Used when switching contexts or resetting
   */
  clearCurrentBallot(): void {
    this.currentBallot = undefined;
  }

  /**
   * Export ballot data for external review systems (privacy-safe)
   * Excludes sensitive information if not revealed
   */
  exportBallot(ballotId: string): Record<string, any> | null {
    const ballot = this.getBallot(ballotId);

    if (!ballot) {
      return null;
    }

    const exportData: Record<string, any> = {
      id: ballot.id,
      prId: ballot.prId,
      decision: ballot.decision,
      confidence: ballot.confidence,
      timestamp: ballot.timestamp.toISOString(),
      revealed: ballot.revealed,
    };

    // Only include rationale and author if revealed
    if (ballot.revealed) {
      exportData.rationale = ballot.rationale;
      exportData.authorId = ballot.authorId;
    } else {
      exportData.rationale = '[Hidden until reveal]';
      exportData.authorId = '[Anonymous]';
    }

    return exportData;
  }

  private generateAnonymousId(): string {
    // Generate a consistent but anonymous ID for the current session
    // This allows tracking without revealing actual identity
    const sessionId = Date.now().toString();
    return `anon-${sessionId.slice(-8)}`;
  }
}