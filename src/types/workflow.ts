export interface WorkflowDefinition {
  config: Record<string, unknown>;
  prompt_template: string;
}

export type OrchestratorMode = "linear" | "autoresearch";

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  api_key: string;
  project_slug: string;
  active_states: string[];
  terminal_states: string[];
}

export interface PollingConfig {
  interval_ms: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  after_create: string | null;
  before_run: string | null;
  after_run: string | null;
  before_remove: string | null;
  timeout_ms: number;
}

export interface AgentConfig {
  max_concurrent_agents: number;
  max_turns: number;
  max_retry_backoff_ms: number;
  max_concurrent_agents_by_state: Record<string, number>;
}

export interface OpenCodeConfig {
  command: string;
  model: string;
  agent: string;
  run_timeout_ms: number;
  stall_timeout_ms: number;
}

export interface AutoresearchConfig {
  program_md: string;
  prepare_py: string;
  train_py: string;
  pyproject_toml: string;
  run_tag: string;
  restart_on_crash: boolean;
  max_crash_restarts: number;
  knowledge_enabled: boolean;
  embedding_endpoint: string | null;
  embedding_model: string;
  searxng_endpoint: string | null;
}

export interface ServerConfig {
  port: number | null;
}

export interface ServiceConfig {
  mode: OrchestratorMode;
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  opencode: OpenCodeConfig;
  autoresearch: AutoresearchConfig;
  server: ServerConfig;
}
