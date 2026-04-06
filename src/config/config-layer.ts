import os from "node:os";
import path from "node:path";
import { resolveEnvVar } from "../utils/env.js";
import { expandPath } from "../utils/path.js";
import type {
  ServiceConfig,
  OrchestratorMode,
  FileCopy,
  BootstrapConfig,
  MetricsConfig,
  ResultsSchema,
  SummaryMetricField,
  ProgressMetricField,
  MetricFieldType,
  MetricDirection,
} from "../types/workflow.js";

/**
 * Build a fully resolved ServiceConfig from raw WORKFLOW.md front matter.
 */
export function buildServiceConfig(
  raw: Record<string, unknown>,
): ServiceConfig {
  const mode = getString(raw, "mode", "linear") as OrchestratorMode;
  const tracker = getObj(raw, "tracker");
  const polling = getObj(raw, "polling");
  const workspace = getObj(raw, "workspace");
  const hooks = getObj(raw, "hooks");
  const agent = getObj(raw, "agent");
  const opencode = getObj(raw, "opencode");
  const autoresearch = getObj(raw, "autoresearch");
  const server = getObj(raw, "server");

  return {
    mode,
    tracker: buildTrackerConfig(tracker),
    polling: buildPollingConfig(polling),
    workspace: buildWorkspaceConfig(workspace),
    hooks: buildHooksConfig(hooks),
    agent: buildAgentConfig(agent),
    opencode: buildOpenCodeConfig(opencode),
    autoresearch: buildAutoresearchConfig(autoresearch),
    server: buildServerConfig(server),
  };
}

function buildTrackerConfig(raw: Record<string, unknown>) {
  const kind = getString(raw, "kind", "");
  const endpoint =
    getString(raw, "endpoint", "") ||
    (kind === "linear" ? "https://api.linear.app/graphql" : "");

  // Resolve API key: check config value, then fall back to canonical env var
  let apiKey = getString(raw, "api_key", "");
  if (apiKey.startsWith("$")) {
    apiKey = resolveEnvVar(apiKey);
  } else if (!apiKey && kind === "linear") {
    apiKey = process.env.LINEAR_API_KEY ?? "";
  }

  return {
    kind,
    endpoint,
    api_key: apiKey,
    project_slug: getString(raw, "project_slug", ""),
    active_states: parseStateList(raw.active_states, ["Todo", "In Progress"]),
    terminal_states: parseStateList(raw.terminal_states, [
      "Closed",
      "Cancelled",
      "Canceled",
      "Duplicate",
      "Done",
    ]),
  };
}

function buildPollingConfig(raw: Record<string, unknown>) {
  return {
    interval_ms: getInt(raw, "interval_ms", 30000),
  };
}

function buildWorkspaceConfig(raw: Record<string, unknown>) {
  const rootRaw = getString(raw, "root", "");
  const defaultRoot = path.join(os.tmpdir(), "symphonic-autoresearch-workspaces");
  const root = rootRaw ? expandPath(rootRaw) : defaultRoot;
  return { root };
}

function buildHooksConfig(raw: Record<string, unknown>) {
  const timeoutMs = getInt(raw, "timeout_ms", 60000);
  return {
    after_create: getStringOrNull(raw, "after_create"),
    before_run: getStringOrNull(raw, "before_run"),
    after_run: getStringOrNull(raw, "after_run"),
    before_remove: getStringOrNull(raw, "before_remove"),
    timeout_ms: timeoutMs > 0 ? timeoutMs : 60000,
  };
}

function buildAgentConfig(raw: Record<string, unknown>) {
  const byStateRaw = raw.max_concurrent_agents_by_state;
  const byState: Record<string, number> = {};
  if (byStateRaw && typeof byStateRaw === "object" && !Array.isArray(byStateRaw)) {
    for (const [key, val] of Object.entries(byStateRaw as Record<string, unknown>)) {
      const num = typeof val === "number" ? val : parseInt(String(val), 10);
      if (Number.isFinite(num) && num > 0) {
        byState[key.trim().toLowerCase()] = num;
      }
    }
  }

  return {
    max_concurrent_agents: getInt(raw, "max_concurrent_agents", 10),
    max_turns: getInt(raw, "max_turns", 20),
    max_retry_backoff_ms: getInt(raw, "max_retry_backoff_ms", 300000),
    max_concurrent_agents_by_state: byState,
  };
}

function buildOpenCodeConfig(raw: Record<string, unknown>) {
  return {
    command: getString(raw, "command", "opencode"),
    model: getString(raw, "model", ""),
    agent: getString(raw, "agent", "build"),
    run_timeout_ms: getInt(raw, "run_timeout_ms", 0), // 0 = no timeout (autoresearch runs forever)
    stall_timeout_ms: getInt(raw, "stall_timeout_ms", 300000),
  };
}

/**
 * Default nanochat-profile metrics/schema/bootstrap. Used when the user
 * doesn't supply the corresponding generic fields in WORKFLOW.md. These
 * defaults encode today's hard-coded behavior so existing configs keep
 * working verbatim.
 */
export const NANOCHAT_METRICS: MetricsConfig = {
  primary: {
    name: "val_bpb",
    direction: "minimize",
    label: "val_bpb",
    format: "%.6f",
  },
  summary_fields: [
    { name: "peak_vram_mb", type: "float", label: "Peak VRAM (MB)" },
    { name: "mfu_percent", type: "float", label: "MFU %" },
    { name: "total_tokens_M", type: "float", label: "Tokens (M)" },
    { name: "num_steps", type: "int", label: "Steps" },
    { name: "num_params_M", type: "float", label: "Params (M)" },
  ],
  progress_line: [
    { name: "step", pattern: "step\\s+(\\d+)", type: "int", label: "Step" },
    { name: "progress_pct", pattern: "\\(([\\d.]+)%\\)", type: "float" },
    { name: "loss", pattern: "loss:\\s+([\\d.]+)", type: "float", label: "Loss" },
    { name: "lr_multiplier", pattern: "lrm:\\s+([\\d.]+)", type: "float" },
    { name: "dt_ms", pattern: "dt:\\s+(\\d+)ms", type: "int" },
    { name: "tok_per_sec", pattern: "tok\\/sec:\\s+([\\d,]+)", type: "int_commas", label: "Tok/s" },
    { name: "mfu_pct", pattern: "mfu:\\s+([\\d.]+)%", type: "float", label: "MFU" },
    { name: "remaining_sec", pattern: "remaining:\\s+(\\d+)s", type: "int" },
  ],
};

export const NANOCHAT_RESULTS_SCHEMA: ResultsSchema = {
  columns: ["commit", "val_bpb", "final_loss", "memory_gb", "status", "description"],
  metric_column: "val_bpb",
  status_column: "status",
  description_column: "description",
  keep_status: "keep",
  discard_statuses: ["discard", "crash"],
};

export const NANOCHAT_BOOTSTRAP: BootstrapConfig = {
  check_paths: [
    "~/.cache/autoresearch/data",
    "~/.cache/autoresearch/tokenizer/tokenizer.pkl",
  ],
  command: "python prepare.py",
  timeout_ms: 300000,
};

function buildAutoresearchConfig(raw: Record<string, unknown>) {
  const program_md = getString(raw, "program_md", "./autoresearch/program.md");
  const prepare_py = getString(raw, "prepare_py", "./autoresearch/prepare.py");
  const train_py = getString(raw, "train_py", "./autoresearch/train.py");
  const pyproject_toml = getString(raw, "pyproject_toml", "./autoresearch/pyproject.toml");

  // Files: explicit list overrides legacy fields. If absent, synthesize
  // from prepare_py/train_py/pyproject_toml (back-compat).
  let files = parseFilesList(raw.files);
  if (files.length === 0) {
    files = synthesizeFilesFromLegacy(prepare_py, train_py, pyproject_toml);
  }

  // Bootstrap: explicit config overrides; null disables; absent = nanochat default.
  let bootstrap: BootstrapConfig | null;
  if (Object.prototype.hasOwnProperty.call(raw, "bootstrap")) {
    const bsRaw = raw.bootstrap;
    if (bsRaw === null) {
      bootstrap = null;
    } else if (bsRaw && typeof bsRaw === "object" && !Array.isArray(bsRaw)) {
      bootstrap = parseBootstrap(bsRaw as Record<string, unknown>);
    } else {
      bootstrap = NANOCHAT_BOOTSTRAP;
    }
  } else {
    bootstrap = NANOCHAT_BOOTSTRAP;
  }

  const metrics = parseMetrics(getObj(raw, "metrics"));
  const results_schema = parseResultsSchema(getObj(raw, "results_schema"));

  return {
    program_md,
    prepare_py,
    train_py,
    pyproject_toml,
    run_tag: getString(raw, "run_tag", new Date().toISOString().slice(5, 10).replace("-", "")),
    restart_on_crash: getBool(raw, "restart_on_crash", true),
    max_crash_restarts: getInt(raw, "max_crash_restarts", 10),
    knowledge_enabled: getBool(raw, "knowledge_enabled", false),
    embedding_endpoint: getStringOrNull(raw, "embedding_endpoint"),
    embedding_model: getString(raw, "embedding_model", ""),
    searxng_endpoint: getStringOrNull(raw, "searxng_endpoint"),
    workspace_name: getString(raw, "workspace_name", "autoresearch"),
    instruction_filename: getString(
      raw,
      "instruction_filename",
      ".symphonic-autoresearch-user-instructions.md",
    ),
    knowledge_query: getString(
      raw,
      "knowledge_query",
      "techniques to improve val_bpb transformer pretraining",
    ),
    files,
    bootstrap,
    metrics,
    results_schema,
  };
}

function synthesizeFilesFromLegacy(
  prepare_py: string,
  train_py: string,
  pyproject_toml: string,
): FileCopy[] {
  const out: FileCopy[] = [];
  if (prepare_py) out.push({ src: prepare_py, dest: "prepare.py" });
  if (train_py) out.push({ src: train_py, dest: "train.py" });
  if (pyproject_toml) out.push({ src: pyproject_toml, dest: "pyproject.toml" });
  return out;
}

function parseFilesList(raw: unknown): FileCopy[] {
  if (!Array.isArray(raw)) return [];
  const out: FileCopy[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const src = getString(obj, "src", "");
    const dest = getString(obj, "dest", "");
    if (src && dest) out.push({ src, dest });
  }
  return out;
}

function parseBootstrap(raw: Record<string, unknown>): BootstrapConfig {
  const checkPathsRaw = raw.check_paths;
  const check_paths: string[] = Array.isArray(checkPathsRaw)
    ? checkPathsRaw.map(String).filter(Boolean)
    : NANOCHAT_BOOTSTRAP.check_paths;
  return {
    check_paths,
    command: getString(raw, "command", NANOCHAT_BOOTSTRAP.command),
    timeout_ms: getInt(raw, "timeout_ms", NANOCHAT_BOOTSTRAP.timeout_ms),
  };
}

function parseMetrics(raw: Record<string, unknown>): MetricsConfig {
  if (Object.keys(raw).length === 0) return NANOCHAT_METRICS;

  const primaryRaw = getObj(raw, "primary");
  const primary = {
    name: getString(primaryRaw, "name", NANOCHAT_METRICS.primary.name),
    direction: (getString(
      primaryRaw,
      "direction",
      NANOCHAT_METRICS.primary.direction,
    ) as MetricDirection),
    label: getString(primaryRaw, "label", NANOCHAT_METRICS.primary.label),
    format: getString(primaryRaw, "format", NANOCHAT_METRICS.primary.format),
  };

  const summary_fields = parseSummaryFields(raw.summary_fields);
  const progress_line = parseProgressLine(raw.progress_line);

  return { primary, summary_fields, progress_line };
}

function parseSummaryFields(raw: unknown): SummaryMetricField[] {
  if (!Array.isArray(raw)) return NANOCHAT_METRICS.summary_fields;
  const out: SummaryMetricField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const name = getString(obj, "name", "");
    if (!name) continue;
    out.push({
      name,
      type: (getString(obj, "type", "float") as MetricFieldType),
      label: getString(obj, "label", name),
    });
  }
  return out;
}

function parseProgressLine(raw: unknown): ProgressMetricField[] {
  if (!Array.isArray(raw)) return NANOCHAT_METRICS.progress_line;
  const out: ProgressMetricField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const name = getString(obj, "name", "");
    const pattern = getString(obj, "pattern", "");
    if (!name || !pattern) continue;
    const label = getString(obj, "label", "");
    out.push({
      name,
      pattern,
      type: (getString(obj, "type", "float") as MetricFieldType),
      label: label || undefined,
    });
  }
  return out;
}

function parseResultsSchema(raw: Record<string, unknown>): ResultsSchema {
  if (Object.keys(raw).length === 0) return NANOCHAT_RESULTS_SCHEMA;
  const columnsRaw = raw.columns;
  const columns: string[] = Array.isArray(columnsRaw)
    ? columnsRaw.map(String).filter(Boolean)
    : NANOCHAT_RESULTS_SCHEMA.columns;
  const discardsRaw = raw.discard_statuses;
  const discard_statuses: string[] = Array.isArray(discardsRaw)
    ? discardsRaw.map(String).filter(Boolean)
    : NANOCHAT_RESULTS_SCHEMA.discard_statuses;
  return {
    columns,
    metric_column: getString(raw, "metric_column", NANOCHAT_RESULTS_SCHEMA.metric_column),
    status_column: getString(raw, "status_column", NANOCHAT_RESULTS_SCHEMA.status_column),
    description_column: getString(
      raw,
      "description_column",
      NANOCHAT_RESULTS_SCHEMA.description_column,
    ),
    keep_status: getString(raw, "keep_status", NANOCHAT_RESULTS_SCHEMA.keep_status),
    discard_statuses,
  };
}

function buildServerConfig(raw: Record<string, unknown>) {
  const portRaw = raw.port;
  let port: number | null = null;
  if (portRaw !== undefined && portRaw !== null) {
    const num = typeof portRaw === "number" ? portRaw : parseInt(String(portRaw), 10);
    if (Number.isFinite(num)) {
      port = num;
    }
  }
  return { port };
}

// --- Helpers ---

function getObj(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const val = parent[key];
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return {};
}

function getString(obj: Record<string, unknown>, key: string, defaultVal: string): string {
  const val = obj[key];
  if (val === undefined || val === null) return defaultVal;
  return String(val);
}

function getStringOrNull(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  if (val === undefined || val === null) return null;
  const str = String(val);
  return str || null;
}

function getInt(obj: Record<string, unknown>, key: string, defaultVal: number): number {
  const val = obj[key];
  if (val === undefined || val === null) return defaultVal;
  const num = typeof val === "number" ? val : parseInt(String(val), 10);
  return Number.isFinite(num) ? num : defaultVal;
}

function getBool(obj: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
  const val = obj[key];
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val.toLowerCase() === "true";
  return defaultVal;
}

function parseStateList(val: unknown, defaults: string[]): string[] {
  if (val === undefined || val === null) return defaults;
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return defaults;
}
