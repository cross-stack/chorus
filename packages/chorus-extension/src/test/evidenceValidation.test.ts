import { describe, it, expect } from 'vitest';
import { validateEvidence } from '../utils/evidenceValidation';
import { EvidenceEntry } from '../types/evidence';

describe('evidenceValidation', () => {
  const validEvidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
    pr_reference: '#123',
    tests_status: 'complete',
    tests_details: 'All tests passing with 95% coverage',
    benchmarks_status: 'n/a',
    benchmarks_details: '',
    spec_status: 'n/a',
    spec_references: '',
    risk_level: 'low',
    identified_risks: '',
    rollback_plan: '',
  };

  describe('valid evidence', () => {
    it('should validate complete evidence with all fields', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#123',
        tests_status: 'complete',
        tests_details: 'All tests passing',
        benchmarks_status: 'complete',
        benchmarks_details: 'Performance improved by 20%',
        spec_status: 'complete',
        spec_references: 'ADR-001, RFC-123',
        risk_level: 'medium',
        identified_risks: 'Database migration required',
        rollback_plan: 'Revert migration script available',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate evidence with only tests complete', () => {
      const result = validateEvidence(validEvidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate evidence with low risk and no rollback plan', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        risk_level: 'low',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate evidence with benchmarks complete', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#456',
        tests_status: 'n/a',
        tests_details: '',
        benchmarks_status: 'complete',
        benchmarks_details: 'Load test results show 50ms p95',
        spec_status: 'n/a',
        spec_references: '',
        risk_level: 'low',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate evidence with specs complete', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#789',
        tests_status: 'n/a',
        tests_details: '',
        benchmarks_status: 'n/a',
        benchmarks_details: '',
        spec_status: 'complete',
        spec_references: 'See ADR-123 for design rationale',
        risk_level: 'low',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validation errors', () => {
    it('should error when pr_reference is empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        pr_reference: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PR Reference is Required');
    });

    it('should error when pr_reference is whitespace only', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        pr_reference: '   ',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PR Reference is Required');
    });

    it('should error when risk_level is high and rollback_plan is empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        risk_level: 'high',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Rollback Plan is Required for High-Risk Changes');
    });

    it('should error when risk_level is high and rollback_plan is whitespace', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        risk_level: 'high',
        rollback_plan: '   ',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Rollback Plan is Required for High-Risk Changes');
    });

    it('should error when tests_status is complete but tests_details is empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        tests_status: 'complete',
        tests_details: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Test Details are Required When Tests Status is Complete');
    });

    it('should error when tests_status is complete but tests_details is whitespace', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        tests_status: 'complete',
        tests_details: '   ',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Test Details are Required When Tests Status is Complete');
    });

    it('should accumulate multiple errors', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '',
        tests_status: 'complete',
        tests_details: '',
        benchmarks_status: 'n/a',
        benchmarks_details: '',
        spec_status: 'n/a',
        spec_references: '',
        risk_level: 'high',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toContain('PR Reference is Required');
      expect(result.errors).toContain('Test Details are Required When Tests Status is Complete');
      expect(result.errors).toContain('Rollback Plan is Required for High-Risk Changes');
    });
  });

  describe('validation warnings', () => {
    it('should warn when no status is complete', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#123',
        tests_status: 'in_progress',
        tests_details: '',
        benchmarks_status: 'n/a',
        benchmarks_details: '',
        spec_status: 'n/a',
        spec_references: '',
        risk_level: 'low',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'At Least One Evidence Section Should Be Marked as Complete'
      );
    });

    it('should warn when benchmarks_status is complete but details empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        benchmarks_status: 'complete',
        benchmarks_details: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'Benchmark Details Should Be Provided When Benchmarks Status is Complete'
      );
    });

    it('should warn when spec_status is complete but references empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        spec_status: 'complete',
        spec_references: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'Specification References Should Be Provided When Spec Status is Complete'
      );
    });

    it('should warn when risk_level is medium but identified_risks is empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        risk_level: 'medium',
        identified_risks: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'Identified Risks Should Be Documented for Medium and High Risk Changes'
      );
    });

    it('should warn when risk_level is high but identified_risks is empty', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        risk_level: 'high',
        identified_risks: '',
        rollback_plan: 'Revert to v1.0',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'Identified Risks Should Be Documented for Medium and High Risk Changes'
      );
    });

    it('should accumulate multiple warnings', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#123',
        tests_status: 'in_progress',
        tests_details: '',
        benchmarks_status: 'complete',
        benchmarks_details: '',
        spec_status: 'complete',
        spec_references: '',
        risk_level: 'medium',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(3);
      expect(result.warnings).toContain(
        'Benchmark Details Should Be Provided When Benchmarks Status is Complete'
      );
      expect(result.warnings).toContain(
        'Specification References Should Be Provided When Spec Status is Complete'
      );
      expect(result.warnings).toContain(
        'Identified Risks Should Be Documented for Medium and High Risk Changes'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle evidence with all statuses as n/a', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#123',
        tests_status: 'n/a',
        tests_details: '',
        benchmarks_status: 'n/a',
        benchmarks_details: '',
        spec_status: 'n/a',
        spec_references: '',
        risk_level: 'low',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'At Least One Evidence Section Should Be Marked as Complete'
      );
    });

    it('should handle evidence with all statuses in_progress', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#123',
        tests_status: 'in_progress',
        tests_details: 'Working on unit tests',
        benchmarks_status: 'in_progress',
        benchmarks_details: 'Running load tests',
        spec_status: 'in_progress',
        spec_references: 'Draft ADR in review',
        risk_level: 'low',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'At Least One Evidence Section Should Be Marked as Complete'
      );
    });

    it('should not warn about low risk with no identified risks', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        risk_level: 'low',
        identified_risks: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.warnings).not.toContain(
        'Identified Risks Should Be Documented for Medium and High Risk Changes'
      );
    });

    it('should handle special characters in pr_reference', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        pr_reference: 'PR-#123-feature/test-branch',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle very long text fields', () => {
      const longText = 'x'.repeat(10000);
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        ...validEvidence,
        tests_details: longText,
        benchmarks_details: longText,
        identified_risks: longText,
        rollback_plan: longText,
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('combinations', () => {
    it('should validate evidence with errors and warnings together', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '',
        tests_status: 'in_progress',
        tests_details: '',
        benchmarks_status: 'n/a',
        benchmarks_details: '',
        spec_status: 'n/a',
        spec_references: '',
        risk_level: 'high',
        identified_risks: '',
        rollback_plan: '',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain('PR Reference is Required');
      expect(result.errors).toContain('Rollback Plan is Required for High-Risk Changes');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should pass all validations with comprehensive evidence', () => {
      const evidence: Omit<EvidenceEntry, 'id' | 'timestamp'> = {
        pr_reference: '#123',
        tests_status: 'complete',
        tests_details: 'All unit tests pass, integration tests pass, 95% coverage',
        benchmarks_status: 'complete',
        benchmarks_details: 'Load test p95 < 100ms, throughput improved 15%',
        spec_status: 'complete',
        spec_references: 'ADR-001: API design, RFC-123: Protocol spec',
        risk_level: 'high',
        identified_risks: 'Breaking API change, database schema migration required',
        rollback_plan:
          'Feature flag enabled, migration rollback script tested, monitoring in place',
      };

      const result = validateEvidence(evidence);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
