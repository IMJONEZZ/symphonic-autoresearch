import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { WorkflowError } from "../types/errors.js";
import type { WorkflowDefinition } from "../types/workflow.js";

/**
 * Load and parse a WORKFLOW.md file into a WorkflowDefinition.
 * Handles YAML front matter delimited by --- and prompt body.
 */
export function loadWorkflow(filePath: string): WorkflowDefinition {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new WorkflowError(
      "missing_workflow_file",
      `Cannot read workflow file: ${filePath}`,
      err,
    );
  }

  return parseWorkflowContent(content);
}

export function parseWorkflowContent(content: string): WorkflowDefinition {
  // Check for YAML front matter
  if (!content.startsWith("---")) {
    return {
      config: {},
      prompt_template: content.trim(),
    };
  }

  // Find closing ---
  const secondDelim = content.indexOf("\n---", 3);
  if (secondDelim === -1) {
    throw new WorkflowError(
      "workflow_parse_error",
      "YAML front matter opened with --- but never closed",
    );
  }

  const yamlContent = content.slice(3, secondDelim).trim();
  const promptBody = content.slice(secondDelim + 4).trim();

  let config: unknown;
  try {
    config = parseYaml(yamlContent);
  } catch (err) {
    throw new WorkflowError(
      "workflow_parse_error",
      `Invalid YAML front matter: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // Empty YAML front matter -> empty config
  if (config === null || config === undefined) {
    return {
      config: {},
      prompt_template: promptBody,
    };
  }

  if (typeof config !== "object" || Array.isArray(config)) {
    throw new WorkflowError(
      "workflow_front_matter_not_a_map",
      "YAML front matter must be a map/object",
    );
  }

  return {
    config: config as Record<string, unknown>,
    prompt_template: promptBody,
  };
}
