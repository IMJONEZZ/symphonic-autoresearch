import fs from "node:fs";
import path from "node:path";

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
}

interface ExperimentResult {
  commit: string;
  valBpb: string;
  finalLoss: string;
  memoryGb: string;
  status: string;
  description: string;
}

function parseResultsTsv(filePath: string): ExperimentResult[] | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return null;

    const lines = content.split("\n");
    if (lines.length < 2) return null;

    const results: ExperimentResult[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [commit, valBpb, finalLoss, memoryGb, status, ...descParts] = line.split("\t");
      results.push({
        commit: commit || "",
        valBpb: valBpb || "0.000000",
        finalLoss: finalLoss || "-",
        memoryGb: memoryGb || "0.0",
        status: status || "unknown",
        description: descParts.join("\t") || "",
      });
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
function formatResultsTable(results: ExperimentResult[], tokenBudget: number): string {
  const header = "| commit | val_bpb | final_loss | memory_gb | status | description |\n" +
    "|--------|---------|------------|-----------|--------|-------------|\n";
  const headerTokens = estimateTokens(header);

  // Build rows from most recent backwards until we hit the budget
  const rows: string[] = [];
  let rowTokens = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    const row = `| ${r.commit} | ${r.valBpb} | ${r.finalLoss} | ${r.memoryGb} | ${r.status} | ${r.description} |\n`;
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

function summarizeResults(results: ExperimentResult[]): string {
  const total = results.length;
  const kept = results.filter((r) => r.status === "keep").length;
  const discarded = results.filter((r) => r.status === "discard").length;
  const crashed = results.filter((r) => r.status === "crash").length;

  let bestValBpb = Infinity;
  let bestCommit = "";
  for (const r of results) {
    if (r.status === "keep") {
      const val = parseFloat(r.valBpb);
      if (!isNaN(val) && val < bestValBpb) {
        bestValBpb = val;
        bestCommit = r.commit;
      }
    }
  }

  const bestLine =
    bestCommit && isFinite(bestValBpb)
      ? `Best val_bpb: ${bestValBpb.toFixed(6)} (commit ${bestCommit}).`
      : "No successful experiments yet.";

  return `${total} experiments run. ${bestLine} ${kept} kept, ${discarded} discarded, ${crashed} crashed.`;
}

/**
 * Get discarded/crashed experiment descriptions, keeping only the most recent
 * that fit within the given token budget.
 */
function getDiscardedDescriptions(results: ExperimentResult[], tokenBudget: number): string[] {
  const all = results
    .filter((r) => r.status === "discard" || r.status === "crash")
    .map((r) => `- [${r.status}] ${r.commit}: ${r.description}`);

  // Take from the end (most recent) until budget exhausted
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

  const resultsPath = path.join(opts.workspacePath, "results.tsv");
  const results = parseResultsTsv(resultsPath);

  // Budget: reserve half of MAX_RESULTS_TOKENS for the table, half for discarded list
  const tableBudget = Math.floor(MAX_RESULTS_TOKENS * 0.6);
  const discardedBudget = Math.floor(MAX_RESULTS_TOKENS * 0.4);

  // Current Experiment State
  prompt += "\n\n## Current Experiment State:\n\n";
  if (results && results.length > 0) {
    prompt += formatResultsTable(results, tableBudget);
    prompt += "\n" + summarizeResults(results) + "\n\n";

    const discarded = getDiscardedDescriptions(results, discardedBudget);
    if (discarded.length > 0) {
      prompt += "**Discarded experiments to avoid repeating:**\n";
      prompt += discarded.join("\n") + "\n";
    }
  } else {
    prompt += "No results.tsv found or file is empty. This may be a fresh run.\n";
  }

  // Crash Recovery
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

  // Research Notes (Phase 3 placeholder)
  if (opts.knowledgeHits && opts.knowledgeHits.length > 0) {
    prompt += "\n## Research Notes from Previous Sessions:\n\n";
    for (const hit of opts.knowledgeHits) {
      prompt += `- ${hit}\n`;
    }
  }

  // Resume Instructions
  prompt += "\n## Resume Instructions:\n\n";
  prompt += "- You are resuming an ongoing experiment run. Read results.tsv for what's been tried.\n";
  prompt += "- Do NOT repeat discarded experiments. Continue from the current best commit.\n";
  prompt += "- Run `git log --oneline -10` to see recent history.\n";

  // Enforce overall prompt token cap
  const totalTokens = estimateTokens(prompt);
  if (totalTokens > MAX_PROMPT_TOKENS) {
    const maxChars = MAX_PROMPT_TOKENS * CHARS_PER_TOKEN;
    // Keep the end of the prompt (most recent context is more valuable)
    prompt = "...[prompt truncated to fit token budget]\n\n" + prompt.slice(prompt.length - maxChars);
  }

  return prompt;
}
