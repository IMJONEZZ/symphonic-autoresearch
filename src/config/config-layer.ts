import os from "node:os";
import path from "node:path";
import { resolveEnvVar } from "../utils/env.js";
import { expandPath } from "../utils/path.js";
import type { ServiceConfig, OrchestratorMode } from "../types/workflow.js";

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
  const defaultRoot = path.join(os.tmpdir(), "symphony_workspaces");
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

function buildAutoresearchConfig(raw: Record<string, unknown>) {
  return {
    program_md: getString(raw, "program_md", "./autoresearch/program.md"),
    prepare_py: getString(raw, "prepare_py", "./autoresearch/prepare.py"),
    train_py: getString(raw, "train_py", "./autoresearch/train.py"),
    pyproject_toml: getString(raw, "pyproject_toml", "./autoresearch/pyproject.toml"),
    run_tag: getString(raw, "run_tag", new Date().toISOString().slice(5, 10).replace("-", "")),
    restart_on_crash: getBool(raw, "restart_on_crash", true),
    max_crash_restarts: getInt(raw, "max_crash_restarts", 10),
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
