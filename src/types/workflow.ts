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

export interface FileCopy {
  src: string;
  dest: string;
}

export interface BootstrapConfig {
  check_paths: string[];
  command: string;
  timeout_ms: number;
}

export type MetricDirection = "minimize" | "maximize";
export type MetricFieldType = "int" | "float" | "int_commas";

export interface PrimaryMetricConfig {
  name: string;
  direction: MetricDirection;
  label: string;
  format: string;
}

export interface SummaryMetricField {
  name: string;
  type: MetricFieldType;
  label: string;
}

export interface ProgressMetricField {
  name: string;
  pattern: string;
  type: MetricFieldType;
  label?: string;
}

export interface MetricsConfig {
  primary: PrimaryMetricConfig;
  summary_fields: SummaryMetricField[];
  progress_line: ProgressMetricField[];
}

export interface ResultsSchema {
  columns: string[];
  metric_column: string;
  status_column: string;
  description_column: string;
  keep_status: string;
  discard_statuses: string[];
}

export interface AutoresearchConfig {
  // Legacy fields (still honored; folded into `files` when present)
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
  // Generic retargeting fields (all optional in user YAML; defaults produce
  // nanochat behavior)
  workspace_name: string;
  instruction_filename: string;
  knowledge_query: string;
  files: FileCopy[];
  bootstrap: BootstrapConfig | null;
  metrics: MetricsConfig;
  results_schema: ResultsSchema;
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
