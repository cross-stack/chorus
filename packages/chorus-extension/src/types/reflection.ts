/**
 * social judgment scheme types used for meta-decision tracking
 * maps to decision-making patterns from social decision theory
 */
export type DecisionSchemeType =
  | 'consensus' // everyone agreed or agreed to disagree
  | 'truth_wins' // evidence or expert opinion prevailed
  | 'majority' // most reviewers agreed
  | 'expert_veto' // senior/expert reviewer made final call
  | 'unanimous' // complete agreement required
  | 'custom'; // custom scheme defined by team

/**
 * trigger types for retrospectives
 * identifies how and why a retrospective was initiated
 */
export type RetrospectiveTriggerType =
  | 'manual' // user manually requested retrospective
  | 'auto_bug_found' // automatically triggered when bug found post-merge
  | 'auto_revert'; // automatically triggered when commit reverted

/**
 * bias pattern identifiers for retrospective analysis
 * maps to known cognitive biases in group decision-making
 */
export type BiasPattern =
  | 'groupthink' // everyone agreed too quickly
  | 'hidden_profile' // important info not surfaced
  | 'status_bias' // deferred to senior without evidence
  | 'overconfidence' // high confidence but wrong outcome
  | 'other'; // custom bias pattern

/**
 * decision scheme entry stored in database
 * tracks which decision rule was applied to a pr review
 */
export interface DecisionSchemeEntry {
  id?: number;
  pr_id: string;
  scheme_type: DecisionSchemeType;
  rationale: string;
  custom_scheme_name?: string;
  timestamp: string;
}

/**
 * retrospective entry stored in database
 * captures post-mortem analysis of review outcomes
 */
export interface RetrospectiveEntry {
  id?: number;
  pr_id: string;
  trigger_type: RetrospectiveTriggerType;
  what_went_wrong: string;
  what_to_improve: string;
  bias_patterns: string; // json array of BiasPattern
  timestamp: string;
}

/**
 * reflection analytics aggregated from historical data
 * provides team-level insights into decision patterns
 */
export interface ReflectionAnalytics {
  scheme_distribution: Record<DecisionSchemeType, number>;
  total_retrospectives: number;
  bias_frequency: Record<BiasPattern | 'other', number>;
  insights: ReflectionInsight[];
}

/**
 * pattern-based insight generated from reflection data
 * highlights potential issues or recommendations
 */
export interface ReflectionInsight {
  type: 'warning' | 'recommendation' | 'observation';
  title: string;
  description: string;
  evidence: string[]; // supporting data points
}

/**
 * filters for querying retrospectives
 * supports date range and pr filtering
 */
export interface RetrospectiveFilters {
  start_date?: string;
  end_date?: string;
  pr_id?: string;
  trigger_type?: RetrospectiveTriggerType;
}

/**
 * data structure for decision scheme modal
 * used when capturing scheme selection during reveal
 */
export interface DecisionSchemeData {
  scheme_type: DecisionSchemeType;
  rationale: string;
  custom_scheme_name?: string;
}

/**
 * data structure for retrospective prompt
 * used when collecting retrospective information
 */
export interface RetrospectiveData {
  what_went_wrong: string;
  what_to_improve: string;
  bias_patterns: BiasPattern[];
  other_bias_description?: string;
}
