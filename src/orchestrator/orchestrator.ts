import type { OrchestratorState, RunningEntry } from "../types/orchestrator.js";
import type { Issue } from "../types/issue.js";
import type { AgentEvent } from "../types/agent.js";
import type { ServiceConfig } from "../types/workflow.js";
import type { ConfigManager } from "../config/watcher.js";
import { validateDispatchConfig } from "../config/validation.js";
import { sortForDispatch, shouldDispatch, hasAvailableSlots } from "./dispatch.js";
import { scheduleRetry, nextAttempt, cancelAllRetries } from "./retry.js";
import {
  detectStalledRuns,
  reconcileTrackerStates,
} from "./reconciliation.js";
import type { TrackerClient } from "../tracker/tracker-client.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { OpenCodeClient } from "../agent/opencode-client.js";
import { runAgentAttempt, runAutoresearch, type WorkerResult } from "../agent/agent-runner.js";
import type { Logger } from "../logging/logger.js";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";

const EVENT_LOG_MAX = 500;
const TRAINING_POLL_MS = 2000;

export class Orchestrator {
  private state: OrchestratorState;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownRequested = false;
  private refreshQueued = false;
  private autoresearchController: AbortController | null = null;
  private autoresearchStatus: AutoresearchStatus = {
    active: false,
    started_at: null,
    last_event: null,
    last_message: null,
    last_event_at: null,
    agent_pid: null,
    crash_count: 0,
    step_count: 0,
    tool_calls: 0,
    uptime_seconds: 0,
  };

  /** Ring buffer of recent agent events for the trace feed */
  private eventLog: EventLogEntry[] = [];

  /** SSE subscribers for real-time event streaming */
  private sseSubscribers: Set<Response> = new Set();

  /** Latest training metrics parsed from run.log */
  private trainingMetrics: TrainingMetrics | null = null;

  /** Interval handle for training log polling */
  private trainingPollTimer: ReturnType<typeof setInterval> | null = null;

  /** Loss history for charting */
  private lossHistory: Array<{ step: number; loss: number; timestamp: string }> = [];

  constructor(
    private configManager: ConfigManager,
    private trackerClient: TrackerClient | null,
    private workspaceManager: WorkspaceManager,
    private openCodeClient: OpenCodeClient,
    private logger: Logger,
  ) {
    const config = configManager.getConfig();
    this.state = {
      poll_interval_ms: config.polling.interval_ms,
      max_concurrent_agents: config.agent.max_concurrent_agents,
      running: new Map(),
      claimed: new Set(),
      retry_attempts: new Map(),
      completed: new Set(),
      agent_totals: {
        experiments_run: 0,
        seconds_running: 0,
        crash_restarts: 0,
      },
    };

    // Listen for config reloads
    configManager.on("reload", (newConfig: ServiceConfig) => {
      this.state.poll_interval_ms = newConfig.polling.interval_ms;
      this.state.max_concurrent_agents = newConfig.agent.max_concurrent_agents;
      this.logger.info(
        {
          poll_interval_ms: this.state.poll_interval_ms,
          max_concurrent_agents: this.state.max_concurrent_agents,
        },
        "Orchestrator config updated from reload",
      );
    });
  }

  /**
   * Start the orchestrator.
   */
  async start(): Promise<void> {
    const config = this.configManager.getConfig();
    const validation = validateDispatchConfig(config);
    if (!validation.ok) {
      throw new Error(
        `Startup validation failed: ${validation.errors.join("; ")}`,
      );
    }

    if (config.mode === "autoresearch") {
      await this.startAutoresearch();
    } else {
      // Linear mode
      await this.startupTerminalCleanup();
      this.scheduleTick(0);
    }
  }

  /**
   * Start autoresearch mode.
   */
  private async startAutoresearch(): Promise<void> {
    this.logger.info("Starting autoresearch mode");

    this.autoresearchController = new AbortController();
    this.autoresearchStatus.active = true;
    this.autoresearchStatus.started_at = new Date().toISOString();

    // Start training log poller
    this.startTrainingPoller();

    const onUpdate = (event: AgentEvent) => {
      this.logger.info(
        { event: event.event, message: event.message },
        "Autoresearch event",
      );

      this.autoresearchStatus.last_event = event.event;
      this.autoresearchStatus.last_event_at = event.timestamp.toISOString();
      if (event.message) this.autoresearchStatus.last_message = event.message;
      if (event.agent_pid) this.autoresearchStatus.agent_pid = event.agent_pid;

      // Track step and tool counts from event messages
      if (event.message?.startsWith("[step_finish]")) {
        this.autoresearchStatus.step_count++;
      } else if (event.message?.startsWith("[tool_use]")) {
        this.autoresearchStatus.tool_calls++;
      }

      if (event.event === "run_crashed") {
        this.state.agent_totals.crash_restarts++;
        this.autoresearchStatus.crash_count++;
      }

      // Push to event log ring buffer and SSE
      this.pushEvent(event);
    };

    const result = await runAutoresearch(
      () => this.configManager.getConfig(),
      this.workspaceManager,
      this.openCodeClient,
      onUpdate,
      this.autoresearchController.signal,
      this.logger,
    );

    this.autoresearchStatus.active = false;
    this.stopTrainingPoller();

    if (!result.success) {
      this.autoresearchStatus.last_event = "stopped_error";
      this.autoresearchStatus.last_message = result.error ?? "Unknown error";
      this.logger.error({ error: result.error }, "Autoresearch exited with failure");
    } else {
      this.autoresearchStatus.last_event = "stopped_clean";
      this.logger.info("Autoresearch exited normally");
    }
  }

  /**
   * Stop the orchestrator gracefully.
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    // Abort autoresearch if running
    if (this.autoresearchController) {
      this.autoresearchController.abort();
    }

    // Stop training poller
    this.stopTrainingPoller();

    // Cancel tick timer
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    // Cancel all retry timers
    cancelAllRetries(this.state);

    // Terminate all running workers
    for (const [issueId, entry] of this.state.running) {
      this.logger.info({ issue_id: issueId }, "Stopping worker for shutdown");
      entry.worker_handle.abort();
    }

    // Wait briefly for workers to finish
    const deadline = Date.now() + 10000;
    while (this.state.running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    this.logger.info("Orchestrator shutdown complete");
  }

  /**
   * Queue an immediate refresh (for HTTP API).
   */
  queueRefresh(): boolean {
    if (this.refreshQueued) return false;
    this.refreshQueued = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.scheduleTick(0);
    return true;
  }

  /**
   * Get a snapshot of current state for observability.
   */
  getSnapshot(): OrchestratorSnapshot {
    const config = this.configManager.getConfig();
    const now = Date.now();
    let liveSeconds = 0;
    for (const entry of this.state.running.values()) {
      liveSeconds += (now - entry.started_at.getTime()) / 1000;
    }

    return {
      generated_at: new Date().toISOString(),
      mode: config.mode,
      counts: {
        running: this.state.running.size,
        retrying: this.state.retry_attempts.size,
      },
      running: Array.from(this.state.running.entries()).map(
        ([issueId, entry]) => ({
          issue_id: issueId,
          issue_identifier: entry.identifier,
          state: entry.issue.state,
          session_id: entry.session_id,
          turn_count: entry.turn_count,
          last_event: entry.last_event,
          last_message: entry.last_message ?? "",
          started_at: entry.started_at.toISOString(),
          last_event_at: entry.last_timestamp?.toISOString() ?? null,
        }),
      ),
      retrying: Array.from(this.state.retry_attempts.entries()).map(
        ([, entry]) => ({
          issue_id: entry.issue_id,
          issue_identifier: entry.identifier,
          attempt: entry.attempt,
          due_at: new Date(entry.due_at_ms).toISOString(),
          error: entry.error,
        }),
      ),
      agent_totals: {
        ...this.state.agent_totals,
        seconds_running:
          Math.round((this.state.agent_totals.seconds_running + liveSeconds) * 10) / 10,
      },
      autoresearch: this.autoresearchStatus.started_at ? {
        ...this.autoresearchStatus,
        uptime_seconds: this.autoresearchStatus.active && this.autoresearchStatus.started_at
          ? Math.round((Date.now() - new Date(this.autoresearchStatus.started_at).getTime()) / 1000)
          : this.autoresearchStatus.uptime_seconds,
      } : null,
      event_log: this.eventLog.slice(-100),
      training: this.trainingMetrics,
      loss_history: this.lossHistory,
    };
  }

  /**
   * Subscribe an SSE response to real-time events.
   */
  addSSESubscriber(res: Response): void {
    this.sseSubscribers.add(res);
    res.on("close", () => this.sseSubscribers.delete(res));
    // Send current event backlog
    for (const entry of this.eventLog.slice(-50)) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  }

  /**
   * Get experiment results from results.tsv in the autoresearch workspace.
   */
  getResults(): ExperimentResult[] {
    const config = this.configManager.getConfig();
    const tsvPath = path.join(config.workspace.root, "autoresearch", "results.tsv");
    try {
      const content = fs.readFileSync(tsvPath, "utf-8");
      const lines = content.trim().split("\n");
      if (lines.length < 2) return [];
      return lines.slice(1).map((line) => {
        const [commit, val_bpb, memory_gb, status, ...descParts] = line.split("\t");
        return {
          commit: commit?.trim() ?? "",
          val_bpb: parseFloat(val_bpb) || 0,
          memory_gb: parseFloat(memory_gb) || 0,
          status: (status?.trim() ?? "unknown") as "keep" | "discard" | "crash",
          description: descParts.join("\t").trim(),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Get current training metrics.
   */
  getTrainingMetrics(): TrainingMetrics | null {
    return this.trainingMetrics;
  }

  /**
   * Push an event to the ring buffer and broadcast to SSE subscribers.
   */
  private pushEvent(event: AgentEvent): void {
    const entry: EventLogEntry = {
      timestamp: event.timestamp.toISOString(),
      type: event.event,
      message: event.message ?? "",
      agent_pid: event.agent_pid,
      raw: event.raw,
    };
    this.eventLog.push(entry);
    if (this.eventLog.length > EVENT_LOG_MAX) {
      this.eventLog = this.eventLog.slice(-EVENT_LOG_MAX);
    }

    // Broadcast to SSE subscribers
    const data = JSON.stringify(entry);
    for (const res of this.sseSubscribers) {
      try {
        res.write(`data: ${data}\n\n`);
      } catch {
        this.sseSubscribers.delete(res);
      }
    }
  }

  /**
   * Poll run.log for training metrics.
   */
  private startTrainingPoller(): void {
    const config = this.configManager.getConfig();
    const runLogPath = path.join(config.workspace.root, "autoresearch", "run.log");

    this.trainingPollTimer = setInterval(() => {
      try {
        if (!fs.existsSync(runLogPath)) return;
        const content = fs.readFileSync(runLogPath, "utf-8");
        // run.log uses \r for in-place updates — take the last line from \r-split
        const lines = content.split(/[\r\n]+/).filter((l) => l.trim());
        if (lines.length === 0) return;

        // Check for final summary block
        const summaryMatch = content.match(/val_bpb:\s+([\d.]+)/);
        const peakVramMatch = content.match(/peak_vram_mb:\s+([\d.]+)/);
        const mfuMatch = content.match(/mfu_percent:\s+([\d.]+)/);
        const totalTokensMatch = content.match(/total_tokens_M:\s+([\d.]+)/);
        const numStepsMatch = content.match(/num_steps:\s+(\d+)/);
        const numParamsMatch = content.match(/num_params_M:\s+([\d.]+)/);

        // Parse the last progress line: "step 00953 (100.0%) | loss: 0.997900 | ..."
        const lastLine = lines[lines.length - 1];
        const stepMatch = lastLine.match(/step\s+(\d+)/);
        const pctMatch = lastLine.match(/\(([\d.]+)%\)/);
        const lossMatch = lastLine.match(/loss:\s+([\d.]+)/);
        const lrmMatch = lastLine.match(/lrm:\s+([\d.]+)/);
        const dtMatch = lastLine.match(/dt:\s+(\d+)ms/);
        const tokSecMatch = lastLine.match(/tok\/sec:\s+([\d,]+)/);
        const mfuLineMatch = lastLine.match(/mfu:\s+([\d.]+)%/);
        const remainingMatch = lastLine.match(/remaining:\s+(\d+)s/);

        const step = stepMatch ? parseInt(stepMatch[1]) : undefined;
        const loss = lossMatch ? parseFloat(lossMatch[1]) : undefined;

        this.trainingMetrics = {
          step,
          progress_pct: pctMatch ? parseFloat(pctMatch[1]) : undefined,
          loss,
          lr_multiplier: lrmMatch ? parseFloat(lrmMatch[1]) : undefined,
          dt_ms: dtMatch ? parseInt(dtMatch[1]) : undefined,
          tok_per_sec: tokSecMatch ? parseInt(tokSecMatch[1].replace(/,/g, "")) : undefined,
          mfu_pct: mfuLineMatch ? parseFloat(mfuLineMatch[1]) : (mfuMatch ? parseFloat(mfuMatch[1]) : undefined),
          remaining_sec: remainingMatch ? parseInt(remainingMatch[1]) : undefined,
          val_bpb: summaryMatch ? parseFloat(summaryMatch[1]) : undefined,
          peak_vram_mb: peakVramMatch ? parseFloat(peakVramMatch[1]) : undefined,
          total_tokens_M: totalTokensMatch ? parseFloat(totalTokensMatch[1]) : undefined,
          num_steps: numStepsMatch ? parseInt(numStepsMatch[1]) : undefined,
          num_params_M: numParamsMatch ? parseFloat(numParamsMatch[1]) : undefined,
          updated_at: new Date().toISOString(),
        };

        // Append to loss history for charting (deduplicate by step)
        if (step !== undefined && loss !== undefined) {
          const last = this.lossHistory[this.lossHistory.length - 1];
          if (!last || last.step !== step) {
            this.lossHistory.push({ step, loss, timestamp: new Date().toISOString() });
            // Keep last 2000 points
            if (this.lossHistory.length > 2000) {
              this.lossHistory = this.lossHistory.slice(-2000);
            }
          }
        }
      } catch {
        // Ignore transient read errors
      }
    }, TRAINING_POLL_MS);
  }

  private stopTrainingPoller(): void {
    if (this.trainingPollTimer) {
      clearInterval(this.trainingPollTimer);
      this.trainingPollTimer = null;
    }
  }

  /**
   * Get issue-specific debug details.
   */
  getIssueDetails(
    issueIdentifier: string,
  ): IssueDetail | null {
    for (const [issueId, entry] of this.state.running) {
      if (entry.identifier === issueIdentifier) {
        return {
          issue_identifier: entry.identifier,
          issue_id: issueId,
          status: "running",
          workspace: {
            path: `${this.configManager.getConfig().workspace.root}/${entry.identifier}`,
          },
          attempts: {
            restart_count: entry.retry_attempt ?? 0,
            current_retry_attempt: entry.retry_attempt,
          },
          running: {
            session_id: entry.session_id,
            turn_count: entry.turn_count,
            state: entry.issue.state,
            started_at: entry.started_at.toISOString(),
            last_event: entry.last_event,
            last_message: entry.last_message ?? "",
            last_event_at: entry.last_timestamp?.toISOString() ?? null,
          },
          retry: null,
          last_error: null,
        };
      }
    }

    for (const [issueId, entry] of this.state.retry_attempts) {
      if (entry.identifier === issueIdentifier) {
        return {
          issue_identifier: entry.identifier,
          issue_id: issueId,
          status: "retrying",
          workspace: {
            path: `${this.configManager.getConfig().workspace.root}/${entry.identifier}`,
          },
          attempts: {
            restart_count: entry.attempt,
            current_retry_attempt: entry.attempt,
          },
          running: null,
          retry: {
            attempt: entry.attempt,
            due_at: new Date(entry.due_at_ms).toISOString(),
            error: entry.error,
          },
          last_error: entry.error,
        };
      }
    }

    return null;
  }

  // --- Private methods ---

  private scheduleTick(delayMs: number): void {
    if (this.shutdownRequested) return;
    this.tickTimer = setTimeout(() => this.onTick(), delayMs);
  }

  private async onTick(): Promise<void> {
    if (this.shutdownRequested) return;
    this.refreshQueued = false;

    try {
      // 1. Reconcile running issues
      await this.reconcileRunningIssues();

      // 2. Re-validate config
      this.configManager.reload();
      const config = this.configManager.getConfig();

      const validation = validateDispatchConfig(config);
      if (!validation.ok) {
        this.logger.error(
          { errors: validation.errors },
          "Dispatch preflight validation failed, skipping dispatch",
        );
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 3. Fetch candidate issues
      if (!this.trackerClient) {
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      let issues: Issue[];
      try {
        issues = await this.trackerClient.fetchCandidateIssues();
      } catch (err) {
        this.logger.error({ err }, "Failed to fetch candidate issues, skipping dispatch");
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 4. Sort and dispatch
      const sorted = sortForDispatch(issues);
      for (const issue of sorted) {
        if (!hasAvailableSlots(this.state)) break;
        if (shouldDispatch(issue, this.state, config)) {
          this.dispatchIssue(issue, null);
        }
      }
    } catch (err) {
      this.logger.error({ err }, "Unexpected error in tick");
    }

    this.scheduleTick(this.state.poll_interval_ms);
  }

  private dispatchIssue(issue: Issue, attempt: number | null): void {
    const controller = new AbortController();
    const log = this.logger.child({
      issue_id: issue.id,
      issue_identifier: issue.identifier,
    });

    log.info({ attempt }, "Dispatching issue");

    const entry: RunningEntry = {
      worker_handle: controller,
      identifier: issue.identifier,
      issue,
      session_id: null,
      agent_pid: null,
      last_message: null,
      last_event: null,
      last_timestamp: null,
      experiment_count: 0,
      turn_count: 0,
      retry_attempt: attempt,
      started_at: new Date(),
    };

    this.state.running.set(issue.id, entry);
    this.state.claimed.add(issue.id);

    const existingRetry = this.state.retry_attempts.get(issue.id);
    if (existingRetry) {
      clearTimeout(existingRetry.timer_handle);
      this.state.retry_attempts.delete(issue.id);
    }

    const workerPromise = runAgentAttempt(
      issue,
      attempt,
      () => this.configManager.getConfig(),
      () => this.configManager.getWorkflow().prompt_template,
      this.workspaceManager,
      this.openCodeClient,
      this.trackerClient!,
      (issueId, event) => this.onAgentUpdate(issueId, event),
      controller.signal,
      log,
    );

    workerPromise
      .then((result) => this.onWorkerExit(issue.id, result))
      .catch((err) => {
        log.error({ err }, "Worker crashed unexpectedly");
        this.onWorkerExit(issue.id, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  private onAgentUpdate(issueId: string, event: AgentEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    entry.last_event = event.event;
    entry.last_timestamp = event.timestamp;
    if (event.message) entry.last_message = event.message;
    if (event.agent_pid) entry.agent_pid = event.agent_pid;

    if (event.event === "session_started" && event.message) {
      entry.turn_count++;
    }
  }

  private onWorkerExit(issueId: string, result: WorkerResult): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    const log = this.logger.child({
      issue_id: issueId,
      issue_identifier: entry.identifier,
    });

    this.state.running.delete(issueId);

    const runtimeSecs = (Date.now() - entry.started_at.getTime()) / 1000;
    this.state.agent_totals.seconds_running += runtimeSecs;

    if (result.success) {
      log.info("Worker completed normally");
      this.state.completed.add(issueId);

      const config = this.configManager.getConfig();
      scheduleRetry(
        this.state,
        issueId,
        1,
        {
          identifier: entry.identifier,
          delayType: "continuation",
          maxBackoffMs: config.agent.max_retry_backoff_ms,
        },
        (id) => this.onRetryTimer(id),
      );
    } else {
      log.warn({ error: result.error }, "Worker failed");

      const config = this.configManager.getConfig();
      const newAttempt = nextAttempt(entry.retry_attempt);
      scheduleRetry(
        this.state,
        issueId,
        newAttempt,
        {
          identifier: entry.identifier,
          error: result.error,
          delayType: "backoff",
          maxBackoffMs: config.agent.max_retry_backoff_ms,
        },
        (id) => this.onRetryTimer(id),
      );
    }
  }

  private async onRetryTimer(issueId: string): Promise<void> {
    const retryEntry = this.state.retry_attempts.get(issueId);
    if (!retryEntry) return;

    this.state.retry_attempts.delete(issueId);

    const log = this.logger.child({
      issue_id: issueId,
      issue_identifier: retryEntry.identifier,
    });

    if (!this.trackerClient) return;

    let candidates: Issue[];
    try {
      candidates = await this.trackerClient.fetchCandidateIssues();
    } catch (err) {
      log.warn({ err }, "Retry poll failed, rescheduling");
      const config = this.configManager.getConfig();
      scheduleRetry(
        this.state,
        issueId,
        retryEntry.attempt + 1,
        {
          identifier: retryEntry.identifier,
          error: "retry poll failed",
          delayType: "backoff",
          maxBackoffMs: config.agent.max_retry_backoff_ms,
        },
        (id) => this.onRetryTimer(id),
      );
      return;
    }

    const issue = candidates.find((i) => i.id === issueId);
    if (!issue) {
      log.info("Issue no longer in candidates, releasing claim");
      this.state.claimed.delete(issueId);
      return;
    }

    if (!hasAvailableSlots(this.state)) {
      log.info("No available slots, rescheduling retry");
      const config = this.configManager.getConfig();
      scheduleRetry(
        this.state,
        issueId,
        retryEntry.attempt + 1,
        {
          identifier: issue.identifier,
          error: "no available orchestrator slots",
          delayType: "backoff",
          maxBackoffMs: config.agent.max_retry_backoff_ms,
        },
        (id) => this.onRetryTimer(id),
      );
      return;
    }

    this.dispatchIssue(issue, retryEntry.attempt);
  }

  private async reconcileRunningIssues(): Promise<void> {
    const config = this.configManager.getConfig();

    // Part A: Stall detection
    const stalled = detectStalledRuns(this.state, config.opencode.stall_timeout_ms);
    for (const issueId of stalled) {
      const entry = this.state.running.get(issueId);
      if (!entry) continue;

      this.logger.warn(
        { issue_id: issueId, issue_identifier: entry.identifier },
        "Stalled session detected, terminating",
      );
      entry.worker_handle.abort();
    }

    // Part B: Tracker state refresh (only in linear mode)
    if (!this.trackerClient) return;

    const actions = await reconcileTrackerStates(
      this.state,
      config,
      this.trackerClient,
      this.logger,
    );

    for (const { issueId, cleanWorkspace } of actions.terminate) {
      const entry = this.state.running.get(issueId);
      if (!entry) continue;

      this.logger.info(
        { issue_id: issueId, issue_identifier: entry.identifier, cleanWorkspace },
        "Terminating run due to reconciliation",
      );

      entry.worker_handle.abort();
      this.state.running.delete(issueId);
      this.state.claimed.delete(issueId);

      const runtimeSecs = (Date.now() - entry.started_at.getTime()) / 1000;
      this.state.agent_totals.seconds_running += runtimeSecs;

      if (cleanWorkspace) {
        try {
          await this.workspaceManager.cleanWorkspace(entry.identifier);
        } catch (err) {
          this.logger.error(
            { issue_id: issueId, err },
            "Failed to clean workspace during reconciliation",
          );
        }
      }
    }

    for (const { issueId, issue } of actions.updateIssues) {
      const entry = this.state.running.get(issueId);
      if (entry) {
        entry.issue = issue;
      }
    }
  }

  private async startupTerminalCleanup(): Promise<void> {
    if (!this.trackerClient) return;

    const config = this.configManager.getConfig();

    try {
      const terminalIssues = await this.trackerClient.fetchIssuesByStates(
        config.tracker.terminal_states,
      );
      for (const issue of terminalIssues) {
        await this.workspaceManager.cleanWorkspace(issue.identifier);
      }
      this.logger.info(
        { count: terminalIssues.length },
        "Startup terminal workspace cleanup complete",
      );
    } catch (err) {
      this.logger.warn({ err }, "Startup terminal cleanup failed, continuing");
    }
  }
}

// --- Snapshot types ---

export interface AutoresearchStatus {
  active: boolean;
  started_at: string | null;
  last_event: string | null;
  last_message: string | null;
  last_event_at: string | null;
  agent_pid: string | null;
  crash_count: number;
  step_count: number;
  tool_calls: number;
  uptime_seconds: number;
}

export interface EventLogEntry {
  timestamp: string;
  type: string;
  message: string;
  agent_pid: string | null;
  raw?: unknown;
}

export interface TrainingMetrics {
  step?: number;
  progress_pct?: number;
  loss?: number;
  lr_multiplier?: number;
  dt_ms?: number;
  tok_per_sec?: number;
  mfu_pct?: number;
  remaining_sec?: number;
  val_bpb?: number;
  peak_vram_mb?: number;
  total_tokens_M?: number;
  num_steps?: number;
  num_params_M?: number;
  updated_at: string;
}

export interface ExperimentResult {
  commit: string;
  val_bpb: number;
  memory_gb: number;
  status: "keep" | "discard" | "crash";
  description: string;
}

export interface OrchestratorSnapshot {
  generated_at: string;
  mode: string;
  counts: { running: number; retrying: number };
  running: Array<{
    issue_id: string;
    issue_identifier: string;
    state: string;
    session_id: string | null;
    turn_count: number;
    last_event: string | null;
    last_message: string;
    started_at: string;
    last_event_at: string | null;
  }>;
  retrying: Array<{
    issue_id: string;
    issue_identifier: string;
    attempt: number;
    due_at: string;
    error: string | null;
  }>;
  agent_totals: {
    experiments_run: number;
    seconds_running: number;
    crash_restarts: number;
  };
  autoresearch: AutoresearchStatus | null;
  event_log: EventLogEntry[];
  training: TrainingMetrics | null;
  loss_history: Array<{ step: number; loss: number; timestamp: string }>;
}

export interface IssueDetail {
  issue_identifier: string;
  issue_id: string;
  status: string;
  workspace: { path: string };
  attempts: { restart_count: number; current_retry_attempt: number | null };
  running: {
    session_id: string | null;
    turn_count: number;
    state: string;
    started_at: string;
    last_event: string | null;
    last_message: string;
    last_event_at: string | null;
  } | null;
  retry: {
    attempt: number;
    due_at: string;
    error: string | null;
  } | null;
  last_error: string | null;
}
