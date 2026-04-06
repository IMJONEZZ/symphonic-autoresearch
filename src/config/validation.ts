import fs from "node:fs";
import type { ServiceConfig } from "../types/workflow.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Dispatch preflight validation.
 * Validates config based on the selected mode.
 * Fails fast with actionable error messages for any invalid configuration.
 */
export function validateDispatchConfig(config: ServiceConfig): ValidationResult {
  const errors: string[] = [];

  // Mode-specific validations
  if (config.mode === "linear") {
    validateLinearMode(config, errors);
  } else if (config.mode === "autoresearch") {
    validateAutoresearchMode(config, errors);
  } else {
    errors.push(`mode "${config.mode}" is not supported. Valid modes: linear, autoresearch`);
  }

  // OpenCode validation (required for all modes)
  if (!config.opencode.command) {
    errors.push("opencode.command must be present and non-empty");
  }
  
  if (!config.opencode.model) {
    errors.push("opencode.model is required. Set it in WORKFLOW.md (e.g., model: your-provider/your-model)");
  }

  // Server port validation
  validatePort(config, errors);

  // Agent config validation
  validateAgentConfig(config, errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

function validateLinearMode(config: ServiceConfig, errors: string[]) {
  if (!config.tracker.kind) {
    errors.push("tracker.kind is required for linear mode");
  } else if (config.tracker.kind !== "linear") {
    errors.push(`tracker.kind "${config.tracker.kind}" is not supported (only "linear" available)`);
  }

  if (!config.tracker.api_key) {
    errors.push(
      "tracker.api_key is required for linear mode.\n" +
      "  Set it in WORKFLOW.md as: api_key: $LINEAR_API_KEY\n" +
      "  Or export: export LINEAR_API_KEY=your-key-here"
    );
  }

  if (config.tracker.kind === "linear" && !config.tracker.project_slug) {
    errors.push(
      "tracker.project_slug is required for linear mode.\n" +
      "  Set it in WORKFLOW.md as: project_slug: your-project-slug"
    );
  }
}

function validateAutoresearchMode(config: ServiceConfig, errors: string[]) {
  const { autoresearch } = config;

  // program_md is always required
  if (!autoresearch.program_md) {
    errors.push("autoresearch.program_md is required for autoresearch mode");
  } else if (!fs.existsSync(autoresearch.program_md)) {
    errors.push(
      `autoresearch.program_md file not found: ${autoresearch.program_md}\n` +
      `  Expected: Agent instructions\n` +
      `  Make sure the path in WORKFLOW.md points to an existing file`
    );
  }

  // Every file in the copy list must exist. This covers both legacy
  // (synthesized from prepare_py/train_py/pyproject_toml) and new
  // explicit `files:` entries.
  if (autoresearch.files.length === 0) {
    errors.push(
      "autoresearch.files is empty. Provide either a `files:` list, " +
      "or legacy fields prepare_py/train_py/pyproject_toml in WORKFLOW.md"
    );
  }
  for (let i = 0; i < autoresearch.files.length; i++) {
    const f = autoresearch.files[i];
    if (!fs.existsSync(f.src)) {
      errors.push(
        `autoresearch.files[${i}].src not found: ${f.src}\n` +
        `  (dest: ${f.dest})\n` +
        `  Make sure the path in WORKFLOW.md points to an existing file`
      );
    }
  }

  // Metrics validation
  const { metrics } = autoresearch;
  if (metrics.primary.direction !== "minimize" && metrics.primary.direction !== "maximize") {
    errors.push(
      `autoresearch.metrics.primary.direction must be "minimize" or "maximize", ` +
      `got "${metrics.primary.direction}"`
    );
  }
  if (!metrics.primary.name) {
    errors.push("autoresearch.metrics.primary.name is required");
  }
  for (let i = 0; i < metrics.progress_line.length; i++) {
    const pl = metrics.progress_line[i];
    try {
      new RegExp(pl.pattern);
    } catch (err) {
      errors.push(
        `autoresearch.metrics.progress_line[${i}].pattern is not a valid regex: ` +
        `${pl.pattern} (${(err as Error).message})`
      );
    }
    if (pl.type !== "int" && pl.type !== "float" && pl.type !== "int_commas") {
      errors.push(
        `autoresearch.metrics.progress_line[${i}].type must be int/float/int_commas, ` +
        `got "${pl.type}"`
      );
    }
  }
  for (let i = 0; i < metrics.summary_fields.length; i++) {
    const sf = metrics.summary_fields[i];
    if (sf.type !== "int" && sf.type !== "float" && sf.type !== "int_commas") {
      errors.push(
        `autoresearch.metrics.summary_fields[${i}].type must be int/float/int_commas, ` +
        `got "${sf.type}"`
      );
    }
  }

  // Results schema validation
  const { results_schema } = autoresearch;
  const cols = results_schema.columns;
  if (!cols.includes("commit")) {
    errors.push(`autoresearch.results_schema.columns must include "commit"`);
  }
  if (!cols.includes(results_schema.metric_column)) {
    errors.push(
      `autoresearch.results_schema.metric_column "${results_schema.metric_column}" ` +
      `is not in columns [${cols.join(", ")}]`
    );
  }
  if (!cols.includes(results_schema.status_column)) {
    errors.push(
      `autoresearch.results_schema.status_column "${results_schema.status_column}" ` +
      `is not in columns [${cols.join(", ")}]`
    );
  }
  if (!cols.includes(results_schema.description_column)) {
    errors.push(
      `autoresearch.results_schema.description_column "${results_schema.description_column}" ` +
      `is not in columns [${cols.join(", ")}]`
    );
  }

  // Validate crash restart settings
  if (autoresearch.max_crash_restarts < 0) {
    errors.push(
      `autoresearch.max_crash_restarts must be >= 0, got ${autoresearch.max_crash_restarts}\n` +
      `  Set to 0 to disable auto-restart on crash`
    );
  }

  // Validate knowledge store config
  if (autoresearch.knowledge_enabled) {
    if (!autoresearch.embedding_endpoint) {
      errors.push(
        "autoresearch.embedding_endpoint is required when knowledge_enabled is true\n" +
        "  Set it to your embedding server URL, e.g.: http://localhost:8080/v1/embeddings"
      );
    }
    if (!autoresearch.embedding_model) {
      errors.push(
        "autoresearch.embedding_model is required when knowledge_enabled is true\n" +
        "  Set it to the model name for embeddings, e.g.: text-embedding-3-small"
      );
    }
  }

  // Validate SearXNG endpoint URL format if set
  if (autoresearch.searxng_endpoint) {
    try {
      new URL(autoresearch.searxng_endpoint);
    } catch {
      errors.push(
        `autoresearch.searxng_endpoint is not a valid URL: ${autoresearch.searxng_endpoint}\n` +
        "  Expected format: http://host:port (e.g., http://localhost:4000)"
      );
    }
  }

  // Validate embedding endpoint URL format if set
  if (autoresearch.embedding_endpoint) {
    try {
      new URL(autoresearch.embedding_endpoint);
    } catch {
      errors.push(
        `autoresearch.embedding_endpoint is not a valid URL: ${autoresearch.embedding_endpoint}\n` +
        "  Expected format: http://host:port/path"
      );
    }
  }
}

function validatePort(config: ServiceConfig, errors: string[]) {
  if (config.server.port !== null) {
    if (!Number.isInteger(config.server.port)) {
      errors.push(`server.port must be an integer, got ${config.server.port}`);
    } else if (config.server.port < 1 || config.server.port > 65535) {
      errors.push(
        `server.port must be between 1 and 65535, got ${config.server.port}\n` +
        "  Common ports: 8080 (default), 3000, 8000"
      );
    }
  }
}

function validateAgentConfig(config: ServiceConfig, errors: string[]) {
  const { agent } = config;

  if (agent.max_concurrent_agents < 1) {
    errors.push(
      `agent.max_concurrent_agents must be >= 1, got ${agent.max_concurrent_agents}`
    );
  }

  if (agent.max_turns < 0) {
    errors.push(`agent.max_turns must be >= 0, got ${agent.max_turns}`);
  }

  if (agent.max_retry_backoff_ms < 0) {
    errors.push(`agent.max_retry_backoff_ms must be >= 0, got ${agent.max_retry_backoff_ms}`);
  }
}
