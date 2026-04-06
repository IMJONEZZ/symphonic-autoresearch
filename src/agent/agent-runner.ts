import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { Issue } from "../types/issue.js";
import type { AgentEvent } from "../types/agent.js";
import type { ServiceConfig } from "../types/workflow.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { OpenCodeClient } from "./opencode-client.js";
import { buildTurnPrompt } from "../prompt/renderer.js";
import { buildAutoresearchPrompt } from "./context-builder.js";
import type { TrackerClient } from "../tracker/tracker-client.js";
import type { Logger } from "../logging/logger.js";
import { expandPath } from "../utils/path.js";
import { createEmbeddingClient } from "../knowledge/embedding-client.js";
import { KnowledgeStore } from "../knowledge/knowledge-store.js";
import { SearchInterceptor } from "../knowledge/search-interceptor.js";

export interface WorkerResult {
  success: boolean;
  error?: string;
}

export type AgentUpdateHandler = (issueId: string, event: AgentEvent) => void;

/**
 * Run an agent attempt for a single issue (linear mode).
 * Launches OpenCode with the rendered prompt.
 */
export async function runAgentAttempt(
  issue: Issue,
  attempt: number | null,
  getConfig: () => ServiceConfig,
  getPromptTemplate: () => string,
  workspaceManager: WorkspaceManager,
  openCodeClient: OpenCodeClient,
  trackerClient: TrackerClient,
  onAgentUpdate: AgentUpdateHandler,
  signal: AbortSignal,
  logger: Logger,
): Promise<WorkerResult> {
  const log = logger.child({ issue_id: issue.id, issue_identifier: issue.identifier });
  let workspacePath: string | null = null;

  try {
    if (signal.aborted) {
      return { success: false, error: "Aborted before start" };
    }

    // 1. Create/reuse workspace
    log.info("Preparing workspace");
    const workspace = await workspaceManager.ensureWorkspace(issue.identifier);
    workspacePath = workspace.path;

    // 2. Run before_run hook
    await workspaceManager.runBeforeRun(workspacePath);

    if (signal.aborted) {
      await workspaceManager.runAfterRun(workspacePath);
      return { success: false, error: "Aborted during preparation" };
    }

    // 3. Build prompt
    const promptTemplate = getPromptTemplate();
    const prompt = await buildTurnPrompt(promptTemplate, issue, attempt, 1);

    // 4. Run OpenCode
    log.info("Starting OpenCode session");
    const onUpdate = (event: AgentEvent) => {
      onAgentUpdate(issue.id, event);
    };

    const result = await openCodeClient.runSession(
      workspacePath,
      prompt,
      onUpdate,
      signal,
    );

    // 5. Cleanup
    await workspaceManager.runAfterRun(workspacePath);

    return {
      success: result.success,
      error: result.error,
    };
  } catch (err) {
    if (workspacePath) {
      await workspaceManager.runAfterRun(workspacePath);
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, `Agent attempt failed: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Run autoresearch mode.
 * Sets up the workspace with autoresearch files, then launches OpenCode
 * with program.md as the prompt. Restarts on crash if configured.
 */
export async function runAutoresearch(
  getConfig: () => ServiceConfig,
  workspaceManager: WorkspaceManager,
  openCodeClient: OpenCodeClient,
  onAgentUpdate: (event: AgentEvent) => void,
  signal: AbortSignal,
  logger: Logger,
): Promise<WorkerResult> {
  const log = logger.child({ component: "autoresearch" });
  const config = getConfig();
  const arConfig = config.autoresearch;

  // 1. Set up workspace
  log.info("Setting up autoresearch workspace");
  const workspace = await workspaceManager.ensureWorkspace(arConfig.workspace_name);
  const workspacePath = workspace.path;

  // 2. Copy autoresearch files into workspace (config-driven)
  for (const { src, dest } of arConfig.files) {
    const srcPath = path.resolve(src);
    const destPath = path.join(workspacePath, dest);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      log.info({ src: srcPath, dest: destPath }, "Copied autoresearch file");
    } else {
      log.warn({ src: srcPath }, "Autoresearch source file not found");
    }
  }

  // 3. Copy .python-version if it lives alongside the first file in the list
  if (arConfig.files.length > 0) {
    const pyVersionSrc = path.join(path.dirname(arConfig.files[0].src), ".python-version");
    if (fs.existsSync(pyVersionSrc)) {
      fs.copyFileSync(pyVersionSrc, path.join(workspacePath, ".python-version"));
    }
  }

  // 4. Run bootstrap command if sentinel paths are missing
  if (arConfig.bootstrap) {
    const missing = arConfig.bootstrap.check_paths
      .map((p) => expandPath(p))
      .filter((p) => !fs.existsSync(p));
    if (missing.length > 0) {
      log.info(
        { missing, command: arConfig.bootstrap.command },
        "Bootstrap sentinel paths missing, running bootstrap command",
      );
      onAgentUpdate({
        event: "notification",
        timestamp: new Date(),
        agent_pid: null,
        message: `Running bootstrap: ${arConfig.bootstrap.command}`,
      });
      execSync(arConfig.bootstrap.command, {
        cwd: workspacePath,
        stdio: "inherit",
        timeout: arConfig.bootstrap.timeout_ms,
        shell: "/bin/sh",
      });
      log.info("Bootstrap completed");
    }
  }

  // 5. Initialize git repo if needed
  await workspaceManager.runBeforeRun(workspacePath);

  // 6. Initialize knowledge store (Phase 3)
  let knowledgeStore: KnowledgeStore | null = null;
  let searchInterceptor: SearchInterceptor | null = null;

  if (arConfig.knowledge_enabled && arConfig.embedding_endpoint && arConfig.embedding_model) {
    try {
      const embeddingClient = createEmbeddingClient(
        arConfig.embedding_endpoint,
        arConfig.embedding_model,
      );
      knowledgeStore = new KnowledgeStore(
        path.join(workspacePath, ".symphonic-autoresearch-knowledge"),
        embeddingClient,
      );
      await knowledgeStore.initialize();
      
      searchInterceptor = new SearchInterceptor((content, source) => {
        if (knowledgeStore) {
          knowledgeStore.addDocument(content, source).catch(() => {});
        }
      });
      
      log.info("Knowledge store initialized");
    } catch (err) {
      log.warn({ err }, "Failed to initialize knowledge store, continuing without persistence");
    }
  }

  // 7. Read program.md as the prompt
  const programMdPath = path.resolve(arConfig.program_md);
  if (!fs.existsSync(programMdPath)) {
    return { success: false, error: `program.md not found at ${programMdPath}` };
  }
  const programPrompt = fs.readFileSync(programMdPath, "utf-8");

  // 8. Run with crash-restart loop
  let crashCount = 0;
  let lastCrashError: string | undefined;
  const maxRestarts = arConfig.max_crash_restarts;

  while (!signal.aborted) {
    log.info(
      { run_tag: arConfig.run_tag, crash_count: crashCount },
      "Starting autoresearch run",
    );

    onAgentUpdate({
      event: "session_started",
      timestamp: new Date(),
      agent_pid: null,
      message: `Autoresearch run starting (tag=${arConfig.run_tag}, restarts=${crashCount})`,
    });

    // Query knowledge store for relevant research notes
    let knowledgeHits: string[] = [];
    if (knowledgeStore) {
      try {
        knowledgeHits = await knowledgeStore.search(
          arConfig.knowledge_query,
          5,
        );
        if (knowledgeHits.length > 0) {
          log.info({ hits: knowledgeHits.length }, "Found relevant knowledge entries");
        }
      } catch (err) {
        log.warn({ err }, "Knowledge search failed, continuing without context");
      }
    }

    const dynamicPrompt = buildAutoresearchPrompt({
      programMd: programPrompt,
      workspacePath,
      crashCount,
      lastCrashError,
      knowledgeHits,
      searxngEndpoint: arConfig.searxng_endpoint,
      resultsSchema: arConfig.results_schema,
      instructionFilename: arConfig.instruction_filename,
      metricDirection: arConfig.metrics.primary.direction,
    });

    // Wrap onAgentUpdate to also intercept webfetch results
    const wrappedOnAgentUpdate = (event: AgentEvent) => {
      if (searchInterceptor) {
        searchInterceptor.processEvent(event);
      }
      onAgentUpdate(event);
    };

    const result = await openCodeClient.runSession(
      workspacePath,
      dynamicPrompt,
      wrappedOnAgentUpdate,
      signal,
    );

    if (signal.aborted) {
      log.info("Autoresearch aborted by signal");
      return { success: true, error: undefined };
    }

    if (result.success) {
      // OpenCode exited cleanly — it shouldn't for autoresearch (NEVER STOP)
      // Restart it
      log.info("OpenCode exited cleanly, restarting autoresearch loop");
      lastCrashError = undefined;
      continue;
    }

    // Crash or error
    crashCount++;
    lastCrashError = result.error;
    log.warn(
      { error: result.error, crash_count: crashCount, max_restarts: maxRestarts },
      "Autoresearch run crashed",
    );

    onAgentUpdate({
      event: "run_crashed",
      timestamp: new Date(),
      agent_pid: null,
      message: `Crash #${crashCount}: ${result.error}`,
    });

    if (!arConfig.restart_on_crash || crashCount >= maxRestarts) {
      return {
        success: false,
        error: `Autoresearch stopped after ${crashCount} crashes. Last: ${result.error}`,
      };
    }

    // Wait a bit before restarting
    const backoffMs = Math.min(5000 * crashCount, 30000);
    log.info({ backoff_ms: backoffMs }, "Waiting before restart");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, backoffMs);
      signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
  }

  return { success: true };
}
