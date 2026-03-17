import { Liquid } from "liquidjs";
import { WorkflowError } from "../types/errors.js";
import type { Issue } from "../types/issue.js";

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

/**
 * Render a prompt template with issue and attempt variables.
 * Uses Liquid-compatible strict rendering.
 */
export async function renderPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
): Promise<string> {
  // Convert issue to a plain object with string-compatible keys for Liquid
  const issueObj: Record<string, unknown> = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    priority: issue.priority,
    state: issue.state,
    branch_name: issue.branch_name ?? "",
    url: issue.url ?? "",
    labels: issue.labels,
    blocked_by: issue.blocked_by.map((b) => ({
      id: b.id ?? "",
      identifier: b.identifier ?? "",
      state: b.state ?? "",
    })),
    created_at: issue.created_at?.toISOString() ?? "",
    updated_at: issue.updated_at?.toISOString() ?? "",
  };

  try {
    const rendered = await engine.parseAndRender(template, {
      issue: issueObj,
      attempt,
    });
    return rendered;
  } catch (err) {
    const isParseError =
      err instanceof Error && err.message.includes("parse");
    throw new WorkflowError(
      isParseError ? "template_parse_error" : "template_render_error",
      `Prompt rendering failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * Build the prompt for a turn.
 * First turn gets the full rendered template.
 * Continuation turns get guidance to continue working.
 */
export async function buildTurnPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
  turnNumber: number,
): Promise<string> {
  if (turnNumber === 1) {
    const rendered = await renderPrompt(template, issue, attempt);
    return rendered || "You are working on an issue from Linear.";
  }

  // Continuation turns - don't resend the original prompt
  return `Continue working on ${issue.identifier}: ${issue.title}. The issue is still in "${issue.state}" state. Pick up where you left off.`;
}
