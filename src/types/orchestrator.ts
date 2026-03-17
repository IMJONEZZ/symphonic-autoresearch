import type { Issue } from "./issue.js";

export interface RunningEntry {
  worker_handle: AbortController;
  identifier: string;
  issue: Issue;
  session_id: string | null;
  agent_pid: string | null;
  last_message: string | null;
  last_event: string | null;
  last_timestamp: Date | null;
  experiment_count: number;
  turn_count: number;
  retry_attempt: number | null;
  started_at: Date;
}

export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout>;
  error: string | null;
}

export interface AgentTotals {
  experiments_run: number;
  seconds_running: number;
  crash_restarts: number;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  agent_totals: AgentTotals;
}

export type RunAttemptPhase =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgentProcess"
  | "StreamingRun"
  | "Finishing"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "CanceledByReconciliation";
