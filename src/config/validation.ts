import type { ServiceConfig } from "../types/workflow.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Dispatch preflight validation.
 * Validates config based on the selected mode.
 */
export function validateDispatchConfig(config: ServiceConfig): ValidationResult {
  const errors: string[] = [];

  if (config.mode === "linear") {
    // Linear mode requires tracker config
    if (!config.tracker.kind) {
      errors.push("tracker.kind is required");
    } else if (config.tracker.kind !== "linear") {
      errors.push(`tracker.kind "${config.tracker.kind}" is not supported (only "linear")`);
    }

    if (!config.tracker.api_key) {
      errors.push("tracker.api_key is required (set in WORKFLOW.md or via LINEAR_API_KEY env var)");
    }

    if (config.tracker.kind === "linear" && !config.tracker.project_slug) {
      errors.push("tracker.project_slug is required when tracker.kind is linear");
    }
  }

  if (!config.opencode.command) {
    errors.push("opencode.command must be present and non-empty");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
