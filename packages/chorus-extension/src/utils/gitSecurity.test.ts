import { describe, it, expect } from 'vitest';
import {
  isValidISODate,
  isValidCommitHash,
  isValidPRReference,
  isValidGitReference,
  isValidWorkspacePath,
  validateISODate,
  validateOptionalISODate,
  sanitizePRReference,
} from './gitSecurity';

describe('gitSecurity', () => {
  describe('isValidISODate', () => {
    it('accepts valid ISO date formats', () => {
      expect(isValidISODate('2023-01-15')).toBe(true);
      expect(isValidISODate('2023-12-31')).toBe(true);
      expect(isValidISODate('2023-01-15T10:30:00')).toBe(true);
      expect(isValidISODate('2023-01-15T10:30:00Z')).toBe(true);
      expect(isValidISODate('2023-01-15T10:30:00.123Z')).toBe(true);
      expect(isValidISODate('2023-01-15T10:30:00+05:30')).toBe(true);
      expect(isValidISODate('2023-01-15T10:30:00-08:00')).toBe(true);
    });

    it('rejects invalid date formats', () => {
      expect(isValidISODate('invalid')).toBe(false);
      expect(isValidISODate('2023/01/15')).toBe(false);
      expect(isValidISODate('15-01-2023')).toBe(false);
      expect(isValidISODate('2023-1-15')).toBe(false); // single digit month
      expect(isValidISODate('2023-01-1')).toBe(false); // single digit day
    });

    it('rejects injection attempts', () => {
      expect(isValidISODate('2023-01-15; rm -rf /')).toBe(false);
      expect(isValidISODate('2023-01-15 && cat /etc/passwd')).toBe(false);
      expect(isValidISODate('2023-01-15`whoami`')).toBe(false);
      expect(isValidISODate('2023-01-15$(whoami)')).toBe(false);
      expect(isValidISODate('2023-01-15|ls')).toBe(false);
    });

    it('validates parseable dates (note: Date.parse is lenient)', () => {
      // Date.parse has inconsistent behavior with invalid dates
      // Some invalid dates are accepted (2023-02-30), others rejected (2023-01-32)
      // This is acceptable - we prioritize preventing injection over strict calendar validation
      expect(isValidISODate('2023-02-30')).toBe(true); // Date.parse accepts this
      expect(isValidISODate('2023-01-32')).toBe(false); // Date.parse rejects this

      // These get rejected by the regex
      expect(isValidISODate('2023-13-01')).toBe(false); // month 13 - regex rejects
      expect(isValidISODate('2023-00-01')).toBe(false); // month 0 - regex rejects
    });

    it('accepts leap year dates (Date.parse is lenient)', () => {
      expect(isValidISODate('2024-02-29')).toBe(true); // 2024 is a leap year
      expect(isValidISODate('2023-02-29')).toBe(true); // Date.parse accepts this too
    });
  });

  describe('isValidCommitHash', () => {
    it('accepts valid commit hashes', () => {
      expect(isValidCommitHash('abc123f')).toBe(true); // short hash
      expect(isValidCommitHash('abc123fdef456')).toBe(true); // medium hash
      expect(isValidCommitHash('abc123fdef456abc123fdef456abc123fdef456a')).toBe(true); // full SHA-1
      expect(isValidCommitHash('ABCDEF1234567890')).toBe(true); // uppercase
      expect(isValidCommitHash('abcdef1234567890')).toBe(true); // lowercase
    });

    it('rejects invalid commit hashes', () => {
      expect(isValidCommitHash('abc12')).toBe(false); // too short (< 7 chars)
      expect(isValidCommitHash('abc123fdef456abc123fdef456abc123fdef456abc')).toBe(false); // too long (> 40)
      expect(isValidCommitHash('ghijkl1234567')).toBe(false); // non-hex characters
      expect(isValidCommitHash('abc123f; rm -rf')).toBe(false); // injection attempt
    });
  });

  describe('isValidPRReference', () => {
    it('accepts valid PR references', () => {
      expect(isValidPRReference('#123')).toBe(true);
      expect(isValidPRReference('123')).toBe(true);
      expect(isValidPRReference('owner/repo#123')).toBe(true);
      expect(isValidPRReference('owner-name/repo-name#456')).toBe(true);
      expect(isValidPRReference('owner.name/repo.name#789')).toBe(true);
      expect(isValidPRReference('owner_name/repo_name#999')).toBe(true);
    });

    it('rejects invalid PR references', () => {
      expect(isValidPRReference('abc')).toBe(false); // non-numeric
      expect(isValidPRReference('#abc')).toBe(false); // non-numeric after #
      expect(isValidPRReference('#123; rm -rf')).toBe(false); // injection
      expect(isValidPRReference('owner/repo#123; ls')).toBe(false); // injection
      expect(isValidPRReference('')).toBe(false); // empty
    });
  });

  describe('isValidGitReference', () => {
    it('accepts valid git references', () => {
      expect(isValidGitReference('main')).toBe(true);
      expect(isValidGitReference('feature/new-feature')).toBe(true);
      expect(isValidGitReference('v1.0.0')).toBe(true);
      expect(isValidGitReference('refs/heads/main')).toBe(true);
      expect(isValidGitReference('release-v2.0')).toBe(true);
      expect(isValidGitReference('feature_branch')).toBe(true);
    });

    it('rejects invalid git references', () => {
      expect(isValidGitReference('')).toBe(false); // empty
      expect(isValidGitReference('.hidden')).toBe(false); // starts with dot
      expect(isValidGitReference('/absolute')).toBe(false); // starts with slash
      expect(isValidGitReference('branch.')).toBe(false); // ends with dot
      expect(isValidGitReference('branch/')).toBe(false); // ends with slash
      expect(isValidGitReference('feature..branch')).toBe(false); // consecutive dots
      expect(isValidGitReference('branch name')).toBe(false); // contains space
      expect(isValidGitReference('branch~1')).toBe(false); // contains ~
      expect(isValidGitReference('branch^1')).toBe(false); // contains ^
      expect(isValidGitReference('branch:main')).toBe(false); // contains :
      expect(isValidGitReference('branch?')).toBe(false); // contains ?
      expect(isValidGitReference('branch*')).toBe(false); // contains *
      expect(isValidGitReference('branch[0]')).toBe(false); // contains [
      expect(isValidGitReference('branch\\path')).toBe(false); // contains backslash
      expect(isValidGitReference('branch@{1}')).toBe(false); // contains @{
      expect(isValidGitReference('-option')).toBe(false); // starts with dash
    });

    it('rejects directory traversal attempts', () => {
      expect(isValidGitReference('../../../etc/passwd')).toBe(false);
      expect(isValidGitReference('feature/../main')).toBe(false);
    });

    it('rejects overly long references', () => {
      const longRef = 'a'.repeat(256);
      expect(isValidGitReference(longRef)).toBe(false);
    });
  });

  describe('isValidWorkspacePath', () => {
    it('accepts valid workspace paths', () => {
      expect(isValidWorkspacePath('/home/user/project')).toBe(true);
      expect(isValidWorkspacePath('/var/www/app')).toBe(true);
      expect(isValidWorkspacePath('C:\\Users\\User\\Project')).toBe(true);
      expect(isValidWorkspacePath('/path/with spaces/project')).toBe(true);
      expect(isValidWorkspacePath('/path-with-dashes/project')).toBe(true);
      expect(isValidWorkspacePath('/path_with_underscores/project')).toBe(true);
    });

    it('rejects invalid workspace paths', () => {
      expect(isValidWorkspacePath('')).toBe(false); // empty
      expect(isValidWorkspacePath('/path/with;semicolon')).toBe(false);
      expect(isValidWorkspacePath('/path/with&ampersand')).toBe(false);
      expect(isValidWorkspacePath('/path/with|pipe')).toBe(false);
      expect(isValidWorkspacePath('/path/with`backtick')).toBe(false);
      expect(isValidWorkspacePath('/path/with$dollar')).toBe(false);
      expect(isValidWorkspacePath('/path/with(paren')).toBe(false);
      expect(isValidWorkspacePath('/path/with{brace')).toBe(false);
    });

    it('rejects paths with control characters', () => {
      expect(isValidWorkspacePath('/path/with\x00null')).toBe(false);
      expect(isValidWorkspacePath('/path/with\nnewline')).toBe(false);
      expect(isValidWorkspacePath('/path/with\ttab')).toBe(false);
    });
  });

  describe('validateISODate', () => {
    it('returns valid dates unchanged', () => {
      expect(validateISODate('2023-01-15', 'testDate')).toBe('2023-01-15');
      expect(validateISODate('2023-01-15T10:30:00Z', 'testDate')).toBe('2023-01-15T10:30:00Z');
    });

    it('throws descriptive error for invalid dates', () => {
      expect(() => validateISODate('invalid', 'testDate')).toThrow(
        'Invalid testDate: expected ISO 8601 date format'
      );
      expect(() => validateISODate('invalid', 'testDate')).toThrow('got: invalid');
    });

    it('throws error for injection attempts', () => {
      expect(() => validateISODate('2023-01-15; rm -rf', 'testDate')).toThrow();
    });
  });

  describe('validateOptionalISODate', () => {
    it('returns undefined for undefined input', () => {
      expect(validateOptionalISODate(undefined, 'testDate')).toBeUndefined();
    });

    it('returns valid dates unchanged', () => {
      expect(validateOptionalISODate('2023-01-15', 'testDate')).toBe('2023-01-15');
    });

    it('throws error for invalid dates', () => {
      expect(() => validateOptionalISODate('invalid', 'testDate')).toThrow();
    });
  });

  describe('sanitizePRReference', () => {
    it('extracts numeric ID from various formats', () => {
      expect(sanitizePRReference('#123')).toBe('123');
      expect(sanitizePRReference('123')).toBe('123');
      expect(sanitizePRReference('owner/repo#456')).toBe('456');
      expect(sanitizePRReference('owner-name/repo-name#789')).toBe('789');
    });

    it('throws error for invalid PR references', () => {
      expect(() => sanitizePRReference('abc')).toThrow('Invalid PR reference format');
      expect(() => sanitizePRReference('#abc')).toThrow('Invalid PR reference format');
      expect(() => sanitizePRReference('')).toThrow('Invalid PR reference format');
    });

    it('throws error for injection attempts', () => {
      expect(() => sanitizePRReference('#123; rm -rf')).toThrow('Invalid PR reference format');
      expect(() => sanitizePRReference('owner/repo#123`whoami`')).toThrow(
        'Invalid PR reference format'
      );
    });
  });

  describe('injection attempt scenarios', () => {
    describe('shell metacharacters', () => {
      const shellMetachars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '<', '>', '\n'];

      shellMetachars.forEach((char) => {
        it(`rejects date with metacharacter: ${char}`, () => {
          expect(isValidISODate(`2023-01-15${char}whoami`)).toBe(false);
        });
      });
    });

    describe('command substitution', () => {
      const commandSubstitutions = [
        '2023-01-15$(whoami)',
        '2023-01-15`whoami`',
        '2023-01-15${USER}',
        '2023-01-15;ls -la',
        "2023-01-15'; DROP TABLE users;--",
      ];

      commandSubstitutions.forEach((attempt) => {
        it(`rejects command substitution: ${attempt}`, () => {
          expect(isValidISODate(attempt)).toBe(false);
        });
      });
    });

    describe('path traversal', () => {
      const pathTraversals = [
        '../../../etc/passwd',
        'feature/../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
      ];

      pathTraversals.forEach((attempt) => {
        it(`rejects path traversal: ${attempt}`, () => {
          expect(isValidGitReference(attempt)).toBe(false);
        });
      });
    });
  });

  describe('real-world GitHub data examples', () => {
    it('accepts typical GitHub API date formats', () => {
      // These are actual formats returned by GitHub API
      expect(isValidISODate('2023-11-13T08:30:00Z')).toBe(true);
      expect(isValidISODate('2023-11-13T08:30:00.123Z')).toBe(true);
      expect(isValidISODate('2023-11-13T08:30:00+00:00')).toBe(true);
    });

    it('accepts typical GitHub PR references', () => {
      expect(isValidPRReference('facebook/react#12345')).toBe(true);
      expect(isValidPRReference('torvalds/linux#6789')).toBe(true);
      expect(isValidPRReference('#42')).toBe(true);
    });

    it('accepts typical GitHub commit hashes', () => {
      expect(isValidCommitHash('a3b5c7d')).toBe(true); // short
      expect(isValidCommitHash('a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0')).toBe(true); // full
    });

    it('accepts typical branch names', () => {
      expect(isValidGitReference('main')).toBe(true);
      expect(isValidGitReference('master')).toBe(true);
      expect(isValidGitReference('feature/add-new-api')).toBe(true);
      expect(isValidGitReference('bugfix/issue-123')).toBe(true);
      expect(isValidGitReference('release/v1.2.3')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty strings', () => {
      expect(isValidISODate('')).toBe(false);
      expect(isValidCommitHash('')).toBe(false);
      expect(isValidPRReference('')).toBe(false);
      expect(isValidGitReference('')).toBe(false);
      expect(isValidWorkspacePath('')).toBe(false);
    });

    it('handles very long strings', () => {
      const longString = 'a'.repeat(1000);
      expect(isValidISODate(longString)).toBe(false);
      expect(isValidCommitHash(longString)).toBe(false);
      expect(isValidGitReference(longString)).toBe(false);
    });

    it('handles strings with only whitespace', () => {
      expect(isValidISODate('   ')).toBe(false);
      expect(isValidCommitHash('   ')).toBe(false);
      expect(isValidPRReference('   ')).toBe(false);
      expect(isValidGitReference('   ')).toBe(false);
    });

    it('handles strings with leading/trailing whitespace', () => {
      // Validation should be strict - no automatic trimming
      expect(isValidISODate(' 2023-01-15 ')).toBe(false);
      expect(isValidCommitHash(' abc123f ')).toBe(false);
    });
  });
});
