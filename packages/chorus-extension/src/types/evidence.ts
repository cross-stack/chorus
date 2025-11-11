/**
 * Evidence status values for test, benchmark, and spec sections
 */
export type EvidenceStatus = 'complete' | 'in_progress' | 'n/a';

/**
 * Risk level values for risk assessment
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Evidence entry stored in database
 */
export interface EvidenceEntry {
  id?: number;
  pr_reference: string;
  timestamp: string;
  tests_status: EvidenceStatus;
  tests_details: string;
  benchmarks_status: EvidenceStatus;
  benchmarks_details: string;
  spec_status: EvidenceStatus;
  spec_references: string;
  risk_level: RiskLevel;
  identified_risks: string;
  rollback_plan: string;
}

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
