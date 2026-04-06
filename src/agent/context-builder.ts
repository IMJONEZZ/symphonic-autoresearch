import fs from "node:fs";
import path from "node:path";
import type { ResultsSchema, MetricDirection } from "../types/workflow.js";

/** Rough token estimate: ~4 characters per token for mixed English/code. */
const CHARS_PER_TOKEN = 4;

/** Maximum tokens for the entire assembled prompt. */
const MAX_PROMPT_TOKENS = 120_000;

/** Maximum tokens for injected results/discarded lists. */
const MAX_RESULTS_TOKENS = 20_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface AutoresearchPromptOptions {
  programMd: string;
  workspacePath: string;
  crashCount: number;
  lastCrashError?: string;
  knowledgeHits?: string[];
  searxngEndpoint?: string | null;
  resultsSchema: ResultsSchema;
  instructionFilename: string;
  metricDirection: MetricDirection;
}

/** One row from the TSV, keyed by column name. */
export type ExperimentResult = Record<string, string>;

/**
 * Header-aware TSV parser. Reads the first line as column names; subsequent
 * rows are mapped into the schema. Rows with fewer cells than columns are
 * padded with empty strings; extra cells on the last column are joined back
 * (preserves tab-free descriptions).
 */
export function parseResultsTsv(
  filePath: string,
  schema: ResultsSchema,
): ExperimentResult[] | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return null;

    const lines = content.split("\n");
    if (lines.length < 2) return null;

    // Use the file's own header if present; fall back to schema.columns
    const headerCells = lines[0].split("\t").map((s) => s.trim());
    const columns =
      headerCells.length > 0 && headerCells.includes(schema.metric_column)
        ? headerCells
        : schema.columns;

    const results: ExperimentResult[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cells = line.split("\t");
      const row: ExperimentResult = {};
      for (let c = 0; c < columns.length; c++) {
        if (c === columns.length - 1) {
          // last column soaks up any trailing tabs
          row[columns[c]] = cells.slice(c).join("\t") ?? "";
        } else {
          row[columns[c]] = cells[c] ?? "";
        }
      }
      results.push(row);
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

/**
 * Format results as a markdown table, keeping only the most recent rows
 * that fit within the results token budget.
 */
function formatResultsTable(
  results: ExperimentResult[],
  schema: ResultsSchema,
  tokenBudget: number,
): string {
  const header =
    "| " + schema.columns.join(" | ") + " |\n" +
    "|" + schema.columns.map(() => "--------").join("|") + "|\n";
  const headerTokens = estimateTokens(header);

  const rows: string[] = [];
  let rowTokens = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    const row = "| " + schema.columns.map((c) => r[c] ?? "").join(" | ") + " |\n";
    const cost = estimateTokens(row);
    if (headerTokens + rowTokens + cost > tokenBudget) break;
    rows.unshift(row);
    rowTokens += cost;
  }

  const skipped = results.length - rows.length;
  let prefix = "";
  if (skipped > 0) {
    prefix = `*(Showing last ${rows.length} of ${results.length} experiments. ${skipped} older experiments omitted.)*\n\n`;
  }

  return prefix + header + rows.join("");
}

function summarizeResults(
  results: ExperimentResult[],
  schema: ResultsSchema,
  direction: MetricDirection,
): string {
  const total = results.length;
  const statusCounts: Record<string, number> = {};
  for (const r of results) {
    const s = r[schema.status_column] ?? "unknown";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const kept = statusCounts[schema.keep_status] ?? 0;
  const discarded = schema.discard_statuses
    .filter((s) => s !== "crash")
    .reduce((acc, s) => acc + (statusCounts[s] ?? 0), 0);
  const crashed = statusCounts["crash"] ?? 0;

  // "Best" respects the metric's direction: argmin if minimize, argmax if maximize.
  const minimize = direction === "minimize";
  let bestVal = minimize ? Infinity : -Infinity;
  let bestCommit = "";
  for (const r of results) {
    if (r[schema.status_column] !== schema.keep_status) continue;
    const val = parseFloat(r[schema.metric_column]);
    if (isNaN(val)) continue;
    if ((minimize && val < bestVal) || (!minimize && val > bestVal)) {
      bestVal = val;
      bestCommit = r["commit"] ?? "";
    }
  }

  const bestLine =
    bestCommit && isFinite(bestVal)
      ? `Best ${schema.metric_column} (${direction}): ${bestVal.toFixed(6)} (commit ${bestCommit}).`
      : "No successful experiments yet.";

  return `${total} experiments run. ${bestLine} ${kept} kept, ${discarded} discarded, ${crashed} crashed.`;
}

/**
 * Get discarded/crashed experiment descriptions, keeping only the most recent
 * that fit within the given token budget.
 */
function getDiscardedDescriptions(
  results: ExperimentResult[],
  schema: ResultsSchema,
  tokenBudget: number,
): string[] {
  const discardSet = new Set(schema.discard_statuses);
  const all = results
    .filter((r) => discardSet.has(r[schema.status_column] ?? ""))
    .map((r) =>
      `- [${r[schema.status_column]}] ${r["commit"] ?? ""}: ${r[schema.description_column] ?? ""}`,
    );

  const kept: string[] = [];
  let tokens = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const cost = estimateTokens(all[i]);
    if (tokens + cost > tokenBudget) break;
    kept.unshift(all[i]);
    tokens += cost;
  }
  return kept;
}

export function buildAutoresearchPrompt(opts: AutoresearchPromptOptions): string {
  let prompt = opts.programMd;

  // Inject SearXNG endpoint if configured (replace placeholder in program.md)
  if (opts.searxngEndpoint) {
    prompt = prompt.replace(/\{\{SEARXNG_ENDPOINT\}\}/g, opts.searxngEndpoint);
  } else {
    // Remove the web search section entirely if not configured
    prompt = prompt.replace(/## Research via web search[\s\S]*?(?=\n## |$)/g, "");
  }

  // Inject instruction filename (async user-instruction inbox)
  prompt = prompt.replace(/\{\{INSTRUCTION_FILE\}\}/g, opts.instructionFilename);

  const resultsPath = path.join(opts.workspacePath, "results.tsv");
  const results = parseResultsTsv(resultsPath, opts.resultsSchema);

  const tableBudget = Math.floor(MAX_RESULTS_TOKENS * 0.6);
  const discardedBudget = Math.floor(MAX_RESULTS_TOKENS * 0.4);

  prompt += "\n\n## Current Experiment State:\n\n";
  if (results && results.length > 0) {
    prompt += formatResultsTable(results, opts.resultsSchema, tableBudget);
    prompt += "\n" + summarizeResults(results, opts.resultsSchema, opts.metricDirection) + "\n\n";

    const discarded = getDiscardedDescriptions(results, opts.resultsSchema, discardedBudget);
    if (discarded.length > 0) {
      prompt += "**Discarded experiments to avoid repeating:**\n";
      prompt += discarded.join("\n") + "\n";
    }
  } else {
    prompt += "No results.tsv found or file is empty. This may be a fresh run.\n";
  }

  if (opts.crashCount > 0) {
    prompt += "\n## Crash Recovery:\n\n";
    prompt += `This session is resuming after crash #${opts.crashCount}.\n`;
    if (opts.lastCrashError) {
      const truncated =
        opts.lastCrashError.length > 500
          ? opts.lastCrashError.slice(0, 500) + "...[truncated]"
          : opts.lastCrashError;
      prompt += `\n**Last error:**\n\`\`\`\n${truncated}\n\`\`\`\n`;
    }
    prompt += "\nCheck git status and git log to understand current state before proceeding.\n";
  }

  if (opts.knowledgeHits && opts.knowledgeHits.length > 0) {
    prompt += "\n## Research Notes from Previous Sessions:\n\n";
    for (const hit of opts.knowledgeHits) {
      prompt += `- ${hit}\n`;
    }
  }

  prompt += "\n## Resume Instructions:\n\n";
  prompt += "- You are resuming an ongoing experiment run. Read results.tsv for what's been tried.\n";
  prompt += "- Do NOT repeat discarded experiments. Continue from the current best commit.\n";
  prompt += "- Run `git log --oneline -10` to see recent history.\n";

  const totalTokens = estimateTokens(prompt);
  if (totalTokens > MAX_PROMPT_TOKENS) {
    const maxChars = MAX_PROMPT_TOKENS * CHARS_PER_TOKEN;
    prompt = "...[prompt truncated to fit token budget]\n\n" + prompt.slice(prompt.length - maxChars);
  }

  return prompt;
}
