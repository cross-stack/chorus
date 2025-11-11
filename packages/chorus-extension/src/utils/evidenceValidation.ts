import { EvidenceEntry, ValidationResult } from '../types/evidence';

/**
 * Validates an evidence entry according to Chorus evidence requirements.
 *
 * Validation rules:
 * 1. At least one status field must be 'complete'
 * 2. If risk_level is 'high', rollback_plan must be non-empty
 * 3. If tests_status is 'complete', tests_details must be non-empty
 * 4. pr_reference must be non-empty string
 *
 * Returns validation result with errors and warnings.
 * Errors indicate critical issues that should block submission.
 * Warnings indicate incomplete or missing optional information.
 *
 * @param evidence - The evidence entry to validate
 * @returns ValidationResult with valid flag, errors, and warnings
 */
export function validateEvidence(
  evidence: Omit<EvidenceEntry, 'id' | 'timestamp'>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // rule 1: pr_reference must be non-empty
  if (!evidence.pr_reference || evidence.pr_reference.trim() === '') {
    errors.push('PR Reference is Required');
  }

  // rule 2: at least one status field must be 'complete'
  const hasCompleteStatus =
    evidence.tests_status === 'complete' ||
    evidence.benchmarks_status === 'complete' ||
    evidence.spec_status === 'complete';

  if (!hasCompleteStatus) {
    warnings.push('At Least One Evidence Section Should Be Marked as Complete');
  }

  // rule 3: if risk_level is 'high', rollback_plan must be non-empty
  if (
    evidence.risk_level === 'high' &&
    (!evidence.rollback_plan || evidence.rollback_plan.trim() === '')
  ) {
    errors.push('Rollback Plan is Required for High-Risk Changes');
  }

  // rule 4: if tests_status is 'complete', tests_details must be non-empty
  if (
    evidence.tests_status === 'complete' &&
    (!evidence.tests_details || evidence.tests_details.trim() === '')
  ) {
    errors.push('Test Details are Required When Tests Status is Complete');
  }

  // additional warning: if benchmarks_status is 'complete', benchmarks_details should be non-empty
  if (
    evidence.benchmarks_status === 'complete' &&
    (!evidence.benchmarks_details || evidence.benchmarks_details.trim() === '')
  ) {
    warnings.push('Benchmark Details Should Be Provided When Benchmarks Status is Complete');
  }

  // additional warning: if spec_status is 'complete', spec_references should be non-empty
  if (
    evidence.spec_status === 'complete' &&
    (!evidence.spec_references || evidence.spec_references.trim() === '')
  ) {
    warnings.push('Specification References Should Be Provided When Spec Status is Complete');
  }

  // additional warning: if risk_level is 'medium' or 'high', identified_risks should be non-empty
  if (
    (evidence.risk_level === 'medium' || evidence.risk_level === 'high') &&
    (!evidence.identified_risks || evidence.identified_risks.trim() === '')
  ) {
    warnings.push('Identified Risks Should Be Documented for Medium and High Risk Changes');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
