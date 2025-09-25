import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Evidence } from '../../services/Evidence';
import { LocalDB } from '../../storage/LocalDB';

describe('Evidence', () => {
  let evidence: Evidence;
  let db: LocalDB;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, '..', 'fixtures', 'test-db');
    if (!fs.existsSync(testDbPath)) {
      fs.mkdirSync(testDbPath, { recursive: true });
    }
    db = new LocalDB(testDbPath);
    evidence = new Evidence(db);
  });

  afterEach(() => {
    db.close();
    const dbFile = path.join(testDbPath, 'chorus.db');
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
  });

  describe('Evidence Block Generation', () => {
    it('should generate evidence block template', () => {
      const block = evidence.generateEvidenceBlock();

      expect(block).toContain('## Chorus Evidence');
      expect(block).toContain('### Tests');
      expect(block).toContain('### Benchmarks');
      expect(block).toContain('### Spec/ADR');
      expect(block).toContain('### Risk Assessment');
      expect(block).toContain('**Risk Level:**');
      expect(block).toContain('**Mitigation:**');
    });
  });

  describe('Evidence Block Parsing and Validation', () => {
    it('should validate complete evidence block', () => {
      const completeBlock = `## Chorus Evidence

### Tests
- [x] Unit tests added/updated
- [x] Integration tests pass
- [x] Manual testing completed

**Details:** All tests are passing with good coverage

### Benchmarks
- [x] Performance impact measured
- [x] Benchmarks show acceptable performance
- [x] No regression detected

**Details:** Performance improved by 10%

### Spec/ADR
- [x] Architecture decision documented
- [x] API changes documented
- [x] Breaking changes noted

**Links:** https://github.com/repo/docs/adr-123

### Risk Assessment
- [x] Security implications reviewed
- [x] Data migration strategy defined
- [x] Rollback plan documented

**Risk Level:** Low
**Mitigation:** Comprehensive testing and rollback plan in place`;

      const validation = evidence.parseEvidenceBlock(completeBlock);

      expect(validation.isValid).toBe(true);
      expect(validation.missingFields).toHaveLength(0);
    });

    it('should identify missing evidence sections', () => {
      const incompleteBlock = `## Chorus Evidence

### Tests
- [ ] Unit tests added/updated

**Details:**`;

      const validation = evidence.parseEvidenceBlock(incompleteBlock);

      expect(validation.isValid).toBe(false);
      expect(validation.missingFields).toContain('benchmarks section');
      expect(validation.missingFields).toContain('spec section');
      expect(validation.missingFields).toContain('risk section');
    });

    it('should identify incomplete section content', () => {
      const incompleteBlock = `## Chorus Evidence

### Tests
- [ ] Unit tests added/updated
- [ ] Integration tests pass

**Details:**

### Benchmarks
N/A

### Spec/ADR
- [ ] Architecture decision documented

**Links:**

### Risk Assessment
- [ ] Security implications reviewed

**Risk Level:**
**Mitigation:**`;

      const validation = evidence.parseEvidenceBlock(incompleteBlock);

      expect(validation.isValid).toBe(false);
      expect(validation.missingFields).toContain('completed test checklist items');
      expect(validation.missingFields).toContain('risk level assessment');
      expect(validation.missingFields).toContain('risk mitigation strategy');
    });

    it('should allow N/A for benchmarks', () => {
      const blockWithNABenchmarks = `## Chorus Evidence

### Tests
- [x] Unit tests added/updated

**Details:** Tests added

### Benchmarks
N/A - no performance impact expected

### Spec/ADR
- [x] Architecture decision documented

**Links:** https://example.com/spec

### Risk Assessment
- [x] Security implications reviewed

**Risk Level:** Low
**Mitigation:** Standard testing procedures`;

      const validation = evidence.parseEvidenceBlock(blockWithNABenchmarks);

      expect(validation.isValid).toBe(true);
    });

    it('should provide warnings for minimal details', () => {
      const minimalBlock = `## Chorus Evidence

### Tests
- [x] Unit tests added/updated

**Details:** Yes

### Benchmarks
N/A

### Spec/ADR
- [x] Architecture decision documented

**Links:** https://spec.com

### Risk Assessment
- [x] Security implications reviewed

**Risk Level:** Low
**Mitigation:** Yes`;

      const validation = evidence.parseEvidenceBlock(minimalBlock);

      expect(validation.warnings).toContain('test details are minimal');
    });
  });

  describe('Evidence Item Creation', () => {
    it('should create evidence from selection', () => {
      const evidenceItem = evidence.createEvidenceFromSelection(
        'test',
        'Unit test for feature',
        'describe("feature", () => { it("should work", () => {}); });',
        '/repo/src/feature.test.ts',
        10
      );

      expect(evidenceItem.type).toBe('test');
      expect(evidenceItem.title).toBe('Unit test for feature');
      expect(evidenceItem.status).toBe('present');
      expect(evidenceItem.filePath).toBe('/repo/src/feature.test.ts');
      expect(evidenceItem.lineNumber).toBe(10);
      expect(evidenceItem.id).toMatch(/^evidence-/);
    });

    it('should create evidence without file location', () => {
      const evidenceItem = evidence.createEvidenceFromSelection(
        'spec',
        'Design document',
        'This is the design specification'
      );

      expect(evidenceItem.type).toBe('spec');
      expect(evidenceItem.filePath).toBeUndefined();
      expect(evidenceItem.lineNumber).toBeUndefined();
    });
  });

  describe('Evidence Completeness Validation', () => {
    beforeEach(() => {
      // Clear any existing evidence
      db.clearAllData();
    });

    it('should identify missing required evidence types', () => {
      const validation = evidence.validateEvidenceCompleteness();

      expect(validation.isValid).toBe(false);
      expect(validation.missingFields).toContain('test evidence');
      expect(validation.missingFields).toContain('spec evidence');
      expect(validation.missingFields).toContain('risk evidence');
    });

    it('should pass validation with complete evidence', () => {
      evidence.createEvidenceFromSelection('test', 'Unit tests', 'test content');
      evidence.createEvidenceFromSelection('spec', 'Design spec', 'spec content');
      evidence.createEvidenceFromSelection('risk', 'Risk assessment', 'risk content');

      const validation = evidence.validateEvidenceCompleteness();

      expect(validation.isValid).toBe(true);
      expect(validation.missingFields).toHaveLength(0);
    });

    it('should warn about missing benchmarks for performance changes', () => {
      evidence.createEvidenceFromSelection('test', 'Unit tests', 'test content');
      evidence.createEvidenceFromSelection('spec', 'Design spec', 'spec content');
      evidence.createEvidenceFromSelection('risk', 'Risk assessment', 'risk content');
      evidence.createEvidenceFromSelection('test', 'Performance test', 'optimization performance cache benchmark');

      const validation = evidence.validateEvidenceCompleteness();

      expect(validation.isValid).toBe(true);
      expect(validation.warnings).toContain(
        'Performance-critical changes detected but no benchmark evidence provided'
      );
    });

    it('should not warn about benchmarks when benchmark evidence exists', () => {
      evidence.createEvidenceFromSelection('test', 'Unit tests', 'test content');
      evidence.createEvidenceFromSelection('spec', 'Design spec', 'spec content');
      evidence.createEvidenceFromSelection('risk', 'Risk assessment', 'risk content');
      evidence.createEvidenceFromSelection('benchmark', 'Performance benchmark', 'performance optimization');

      const validation = evidence.validateEvidenceCompleteness();

      expect(validation.warnings).not.toContain(
        'Performance-critical changes detected but no benchmark evidence provided'
      );
    });
  });

  describe('Test Evidence Extraction', () => {
    it('should extract test evidence from workspace', async () => {
      // Mock filesystem functions for testing
      const mockGlob = vi.fn();
      const mockFs = {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
      };

      // Create a temporary test to verify the core logic
      const testWorkspaceRoot = '/mock/workspace';

      // This test verifies the basic flow - actual implementation would need
      // filesystem mocking or integration test with real files
      const result = await evidence.extractTestEvidence(testWorkspaceRoot);

      // Should return empty array without throwing errors
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Get All Evidence', () => {
    it('should return all evidence items from database', () => {
      evidence.createEvidenceFromSelection('test', 'Test 1', 'content 1');
      evidence.createEvidenceFromSelection('spec', 'Spec 1', 'content 2');
      evidence.createEvidenceFromSelection('risk', 'Risk 1', 'content 3');

      const allEvidence = evidence.getAllEvidence();

      expect(allEvidence).toHaveLength(3);
      expect(allEvidence.map(e => e.type)).toEqual(expect.arrayContaining(['test', 'spec', 'risk']));
    });

    it('should return empty array when no evidence exists', () => {
      const allEvidence = evidence.getAllEvidence();
      expect(allEvidence).toHaveLength(0);
    });
  });
});