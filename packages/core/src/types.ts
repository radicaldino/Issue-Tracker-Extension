export interface RepoRef {
  owner: string;
  repo: string;
}

export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface Issue {
  /** Stable across sources and sessions, e.g. "github:owner/repo#123". */
  key: string;
  source: 'github';
  repo: RepoRef;
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  author: string;
  updatedAt: string;
}

/** Where issues come from. GitHub today; Jira and GitLab implement the same shape later. */
export interface IssueSource {
  listAssigned(repo: RepoRef): Promise<Issue[]>;
  getComments(issue: Issue): Promise<IssueComment[]>;
}

/** A code range the agent thinks is relevant. Paths are relative to the workspace root; lines are 1-based and inclusive. */
export interface CodeLocation {
  file: string;
  startLine: number;
  endLine: number;
  reason: string;
}

/** Replace the single exact occurrence of `search` in `file` with `replace`. */
export interface ProposedEdit {
  file: string;
  search: string;
  replace: string;
  description: string;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface AnalysisResult {
  summary: string;
  /** Markdown. */
  explanation: string;
  confidence: Confidence;
  locations: CodeLocation[];
  edits: ProposedEdit[];
}

export interface AnalysisRun {
  provider: string;
  result: AnalysisResult;
  costUsd?: number;
  durationMs: number;
  turns: number;
  finishedAt: string;
}

export type ProgressEvent =
  | { kind: 'tool'; message: string }
  | { kind: 'text'; message: string };

export interface AnalyzeOptions {
  /** Workspace root the agent explores. */
  cwd: string;
  comments?: IssueComment[];
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * One coding agent behind a common interface. v1 only analyzes (read-only);
 * delegating a full task (start, stream progress, return a diff) comes with
 * the Codex / Aider / Copilot adapters.
 */
export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  analyze(issue: Issue, options: AnalyzeOptions): Promise<AnalysisRun>;
}
