export interface LiveSession {
  session_id: string;
  agent_pid: string | null;
  last_event: string | null;
  last_timestamp: Date | null;
  last_message: string | null;
  experiment_count: number;
}

export type AgentEventType =
  | "session_started"
  | "startup_failed"
  | "run_completed"
  | "run_failed"
  | "run_crashed"
  | "experiment_started"
  | "experiment_completed"
  | "experiment_failed"
  | "process_exited"
  | "notification"
  | "other_message";

export interface AgentEvent {
  event: AgentEventType;
  timestamp: Date;
  agent_pid: string | null;
  message?: string;
  raw?: unknown;
}

export interface RunResult {
  success: boolean;
  event: AgentEventType;
  error?: string;
  exit_code?: number;
}
