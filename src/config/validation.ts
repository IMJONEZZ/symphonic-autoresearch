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

  // Validate required file paths exist
  const filesToCheck = [
    { path: autoresearch.program_md, name: "autoresearch.program_md", description: "Agent instructions" },
    { path: autoresearch.prepare_py, name: "autoresearch.prepare_py", description: "Data preparation script" },
    { path: autoresearch.train_py, name: "autoresearch.train_py", description: "Training script (agent modifies this)" },
  ];

  for (const file of filesToCheck) {
    if (!file.path) {
      errors.push(`${file.name} is required for autoresearch mode`);
    } else if (!fs.existsSync(file.path)) {
      errors.push(
        `${file.name} file not found: ${file.path}\n` +
        `  Expected: ${file.description}\n` +
        `  Make sure the path in WORKFLOW.md points to an existing file`
      );
    }
  }

  // pyproject.toml is optional but warn if specified and missing
  if (autoresearch.pyproject_toml && !fs.existsSync(autoresearch.pyproject_toml)) {
    errors.push(
      `autoresearch.pyproject_toml file not found: ${autoresearch.pyproject_toml}\n` +
      `  This file defines Python dependencies for the training environment`
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
