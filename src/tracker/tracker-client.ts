import type { Issue } from "../types/issue.js";

/**
 * Abstract tracker interface. Implementations normalize results to Issue[].
 */
export interface TrackerClient {
  /** Fetch issues in configured active states for the configured project. */
  fetchCandidateIssues(): Promise<Issue[]>;

  /** Fetch issues by specific state names (used for startup terminal cleanup). */
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;

  /** Fetch current state for specific issue IDs (used for reconciliation). */
  fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]>;
}
