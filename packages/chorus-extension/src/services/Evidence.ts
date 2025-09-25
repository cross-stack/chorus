import { EvidenceItem } from '../types';
import { LocalDB } from '../storage/LocalDB';

export interface EvidenceValidationResult {
  isValid: boolean;
  missingFields: string[];
  warnings: string[];
}

export class Evidence {
  private db: LocalDB;

  constructor(db: LocalDB) {
    this.db = db;
  }

  /**
   * Generate evidence block template for PR descriptions
   */
  generateEvidenceBlock(): string {
    return `## Chorus Evidence

### Tests
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

**Details:**

### Benchmarks
- [ ] Performance impact measured
- [ ] Benchmarks show acceptable performance
- [ ] No regression detected

**Details:**

### Spec/ADR
- [ ] Architecture decision documented
- [ ] API changes documented
- [ ] Breaking changes noted

**Links:**

### Risk Assessment
- [ ] Security implications reviewed
- [ ] Data migration strategy defined
- [ ] Rollback plan documented

**Risk Level:** Low | Medium | High
**Mitigation:** `;
  }

  /**
   * Parse evidence block from text and validate completeness
   */
  parseEvidenceBlock(text: string): EvidenceValidationResult {
    const sections = this.extractEvidenceSections(text);
    const missingFields: string[] = [];
    const warnings: string[] = [];

    // Check for required sections
    const requiredSections = ['tests', 'benchmarks', 'spec', 'risk'];

    for (const section of requiredSections) {
      if (!sections[section]) {
        missingFields.push(`${section} section`);
      } else {
        // Validate section content
        const validation = this.validateSection(section, sections[section]);
        if (!validation.isValid) {
          missingFields.push(...validation.missingFields);
        }
        warnings.push(...validation.warnings);
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
      warnings,
    };
  }

  /**
   * Extract test evidence from current workspace
   * Scans for test files and test results
   */
  async extractTestEvidence(workspaceRoot: string): Promise<EvidenceItem[]> {
    const testEvidence: EvidenceItem[] = [];

    try {
      const fs = require('fs');
      const path = require('path');

      // Common test file patterns
      const testPatterns = [
        '**/*.test.{js,ts,jsx,tsx}',
        '**/*.spec.{js,ts,jsx,tsx}',
        '**/test/**/*.{js,ts,jsx,tsx}',
        '**/tests/**/*.{js,ts,jsx,tsx}',
      ];

      // Use glob to find test files
      const glob = require('glob');
      const testFiles: string[] = [];

      for (const pattern of testPatterns) {
        const files = glob.sync(pattern, { cwd: workspaceRoot, absolute: true });
        testFiles.push(...files);
      }

      // Remove duplicates
      const uniqueTestFiles = [...new Set(testFiles)];

      for (const testFile of uniqueTestFiles) {
        if (fs.existsSync(testFile)) {
          const content = fs.readFileSync(testFile, 'utf8');
          const testCount = this.countTests(content);

          const evidenceItem: EvidenceItem = {
            id: `test-${this.hashString(testFile)}`,
            type: 'test',
            title: `Test File: ${path.basename(testFile)}`,
            content: `Found ${testCount} test cases`,
            status: testCount > 0 ? 'present' : 'missing',
            filePath: testFile,
          };

          testEvidence.push(evidenceItem);
          this.db.insertEvidenceItem(evidenceItem);
        }
      }
    } catch (error) {
      console.error('Failed to extract test evidence:', error);
    }

    return testEvidence;
  }

  /**
   * Create evidence item from code selection
   * Used for "paste from tests" command
   */
  createEvidenceFromSelection(
    type: EvidenceItem['type'],
    title: string,
    content: string,
    filePath?: string,
    lineNumber?: number
  ): EvidenceItem {
    const evidenceItem: EvidenceItem = {
      id: `evidence-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      content,
      status: 'present',
      filePath,
      lineNumber,
    };

    this.db.insertEvidenceItem(evidenceItem);
    return evidenceItem;
  }

  /**
   * Get all evidence items for current context
   */
  getAllEvidence(): EvidenceItem[] {
    return this.db.getEvidenceItems();
  }

  /**
   * Validate evidence completeness for PR
   */
  validateEvidenceCompleteness(): EvidenceValidationResult {
    const evidence = this.getAllEvidence();
    const missingFields: string[] = [];
    const warnings: string[] = [];

    const requiredTypes: EvidenceItem['type'][] = ['test', 'spec', 'risk'];
    const hasType = (type: EvidenceItem['type']) =>
      evidence.some(item => item.type === type && item.status === 'present');

    for (const type of requiredTypes) {
      if (!hasType(type)) {
        missingFields.push(`${type} evidence`);
      }
    }

    // Check for benchmark evidence if performance-critical
    const hasPerformanceCriticalChanges = evidence.some(item =>
      /\b(performance|benchmark|speed|optimization|cache)\b/i.test(item.content)
    );

    if (hasPerformanceCriticalChanges && !hasType('benchmark')) {
      warnings.push('Performance-critical changes detected but no benchmark evidence provided');
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
      warnings,
    };
  }

  private extractEvidenceSections(text: string): Record<string, string> {
    const sections: Record<string, string> = {};

    // Match evidence sections using regex
    const sectionPatterns = {
      tests: /### Tests\s*([\s\S]*?)(?=###|$)/i,
      benchmarks: /### Benchmarks\s*([\s\S]*?)(?=###|$)/i,
      spec: /### Spec\/ADR\s*([\s\S]*?)(?=###|$)/i,
      risk: /### Risk Assessment\s*([\s\S]*?)(?=###|$)/i,
    };

    for (const [key, pattern] of Object.entries(sectionPatterns)) {
      const match = text.match(pattern);
      if (match) {
        sections[key] = match[1].trim();
      }
    }

    return sections;
  }

  private validateSection(sectionName: string, content: string): EvidenceValidationResult {
    const missingFields: string[] = [];
    const warnings: string[] = [];

    switch (sectionName) {
      case 'tests':
        if (!content.includes('- [x]') && !content.includes('- [X]')) {
          missingFields.push('completed test checklist items');
        }
        if (!content.includes('Details:') || content.split('Details:')[1]?.trim().length < 10) {
          warnings.push('test details are minimal');
        }
        break;

      case 'benchmarks':
        if (content.toLowerCase().includes('n/a')) {
          // N/A is acceptable for benchmarks
          break;
        }
        if (!content.includes('- [x]') && !content.includes('- [X]')) {
          missingFields.push('completed benchmark checklist items');
        }
        break;

      case 'spec':
        if (!content.includes('Links:') || content.split('Links:')[1]?.trim().length < 5) {
          warnings.push('no specification or ADR links provided');
        }
        break;

      case 'risk':
        if (!content.includes('Risk Level:') || !content.match(/Risk Level:\s*(Low|Medium|High)/i)) {
          missingFields.push('risk level assessment');
        }
        if (!content.includes('Mitigation:') || content.split('Mitigation:')[1]?.trim().length < 10) {
          missingFields.push('risk mitigation strategy');
        }
        break;
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
      warnings,
    };
  }

  private countTests(content: string): number {
    // Count common test patterns
    const testPatterns = [
      /\bit\s*\(/g,           // it('test name'
      /\btest\s*\(/g,         // test('test name'
      /\bdescribe\s*\(/g,     // describe('suite name'
      /\bcontext\s*\(/g,      // context('context name'
    ];

    let count = 0;
    for (const pattern of testPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        count += matches.length;
      }
    }

    return count;
  }

  private hashString(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString();
  }
}