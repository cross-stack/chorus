export interface ContextItem {
  id: string;
  type: 'pr' | 'commit' | 'doc' | 'issue';
  title: string;
  content: string;
  path: string;
  timestamp: Date;
  author?: string;
  score: number;
}

export interface EvidenceItem {
  id: string;
  type: 'test' | 'benchmark' | 'spec' | 'adr' | 'risk';
  title: string;
  content: string;
  status: 'present' | 'missing' | 'n/a';
  filePath?: string;
  lineNumber?: number;
}

export interface QuietBallot {
  id: string;
  prId: string;
  decision: 'approve' | 'reject' | 'needs-work';
  confidence: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  timestamp: Date;
  revealed: boolean;
  authorId?: string;
}

export interface PanelState {
  activeTab: 'context' | 'evidence' | 'equity';
  contextItems: ContextItem[];
  evidenceItems: EvidenceItem[];
  ballot?: QuietBallot;
}

export interface SearchQuery {
  terms: string[];
  type?: ContextItem['type'];
  timeRange?: { start: Date; end: Date };
}

export interface BM25Result {
  item: ContextItem;
  score: number;
  matchedTerms: string[];
}