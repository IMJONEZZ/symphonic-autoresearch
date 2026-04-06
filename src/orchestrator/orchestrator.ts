import type { OrchestratorState, RunningEntry } from "../types/orchestrator.js";
import type { Issue } from "../types/issue.js";
import type { AgentEvent } from "../types/agent.js";
import type { ServiceConfig, MetricsConfig, ResultsSchema } from "../types/workflow.js";
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
import { HardwareMonitor, type HardwareMetrics } from "../monitor/hardware-monitor.js";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";

const EVENT_LOG_MAX = 500;
const TRAINING_POLL_MS = 2000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  private lossHistory: Array<{ step: number; loss: number; timestamp: string; experiment: number }> = [];
  private currentExperiment = 0;

  /** Hardware metrics monitor */
  private hardwareMonitor: HardwareMonitor | null = null;

  /** Instruction queue for user instructions to autoresearch agent */
  private pendingInstruction: { message: string; submitted_at: string } | null = null;
  private instructionStatus: "none" | "queued" | "delivered" = "none";
  private instructionDeliveredAt: string | null = null;

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

    this.hardwareMonitor = new HardwareMonitor();

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

    // Start hardware monitor
    if (this.hardwareMonitor) {
      this.hardwareMonitor.start();
    }

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

      // Deliver queued user instructions on step_finish or experiment completion
      if (this.pendingInstruction) {
        const isStepFinish = event.message?.startsWith("[step_finish]");
        const isExperimentDone = event.message?.includes("val_bpb");
        if (isStepFinish || isExperimentDone) {
          this.deliverPendingInstruction();
        }
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
    if (this.hardwareMonitor) {
      this.hardwareMonitor.stop();
    }

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

    // Stop hardware monitor
    if (this.hardwareMonitor) {
      this.hardwareMonitor.stop();
    }

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
      hardware: this.hardwareMonitor?.getMetrics() ?? null,
      instruction: this.getInstructionStatus(),
      autoresearch_metrics: config.mode === "autoresearch" ? config.autoresearch.metrics : null,
      autoresearch_schema: config.mode === "autoresearch" ? config.autoresearch.results_schema : null,
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
   * Parsing is schema-driven from autoresearch.results_schema.
   */
  getResults(): ExperimentResult[] {
    const config = this.configManager.getConfig();
    const schema = config.autoresearch.results_schema;
    const direction = config.autoresearch.metrics.primary.direction;
    const tsvPath = path.join(
      config.workspace.root,
      config.autoresearch.workspace_name,
      "results.tsv",
    );
    try {
      const raw = fs.readFileSync(tsvPath, "utf-8");
      const lines = raw.trim().split("\n");
      if (lines.length < 2) return [];

      // Prefer the header written by the agent if it contains the metric column.
      const headerCells = lines[0].split("\t").map((s) => s.trim());
      const columns = headerCells.includes(schema.metric_column) ? headerCells : schema.columns;

      const results: ExperimentResult[] = lines.slice(1)
        .filter((l) => l.trim())
        .map((line) => {
          const cells = line.split("\t");
          const row: Record<string, string> = {};
          for (let c = 0; c < columns.length; c++) {
            if (c === columns.length - 1) {
              row[columns[c]] = cells.slice(c).join("\t").trim();
            } else {
              row[columns[c]] = (cells[c] ?? "").trim();
            }
          }
          const metric = parseFloat(row[schema.metric_column] ?? "");
          return {
            commit: row["commit"] ?? "",
            status: row[schema.status_column] ?? "unknown",
            description: row[schema.description_column] ?? "",
            metric: Number.isNaN(metric) ? NaN : metric,
            row,
          };
        });

      // Recompute running-best status: walk in order and mark each row that
      // improved on the running best as keep_status; otherwise first discard_status.
      const minimize = direction === "minimize";
      const firstDiscard = schema.discard_statuses.find((s) => s !== "crash") ?? "discard";
      let runningBest = minimize ? Infinity : -Infinity;
      for (const r of results) {
        if (r.status === "crash") continue;
        if (!Number.isFinite(r.metric)) continue;
        const isBetter = minimize ? r.metric < runningBest : r.metric > runningBest;
        if (isBetter) {
          r.status = schema.keep_status;
          r.row[schema.status_column] = schema.keep_status;
          runningBest = r.metric;
        } else {
          r.status = firstDiscard;
          r.row[schema.status_column] = firstDiscard;
        }
      }

      return results;
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
   * Get current hardware metrics.
   */
  getHardwareMetrics(): HardwareMetrics | null {
    return this.hardwareMonitor?.getMetrics() ?? null;
  }

  /**
   * Queue a user instruction for delivery to the autoresearch agent.
   */
  queueInstruction(message: string): void {
    this.pendingInstruction = { message, submitted_at: new Date().toISOString() };
    this.instructionStatus = "queued";
    this.logger.info({ message: message.slice(0, 100) }, "User instruction queued");
  }

  /**
   * Get the current status of any pending user instruction.
   */
  getInstructionStatus(): { status: string; message?: string; submitted_at?: string; delivered_at?: string } {
    if (this.instructionStatus === "queued" && this.pendingInstruction) {
      return { status: "queued", message: this.pendingInstruction.message, submitted_at: this.pendingInstruction.submitted_at };
    }
    if (this.instructionStatus === "delivered") {
      return { status: "delivered", delivered_at: this.instructionDeliveredAt ?? undefined };
    }
    return { status: "none" };
  }

  /**
   * Deliver a pending instruction to the autoresearch workspace.
   */
  private deliverPendingInstruction(): void {
    if (!this.pendingInstruction) return;
    const config = this.configManager.getConfig();
    const filePath = path.join(
      config.workspace.root,
      config.autoresearch.workspace_name,
      config.autoresearch.instruction_filename,
    );
    try {
      fs.writeFileSync(filePath, this.pendingInstruction.message, "utf-8");
      this.instructionStatus = "delivered";
      this.instructionDeliveredAt = new Date().toISOString();
      this.logger.info("User instruction delivered to workspace");
      this.pendingInstruction = null;
    } catch (err) {
      this.logger.error({ err }, "Failed to write user instruction file");
    }
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
   * Poll run.log for training metrics. Regexes are built from the user's
   * metrics config so arbitrary pipelines can expose arbitrary fields.
   */
  private startTrainingPoller(): void {
    const config = this.configManager.getConfig();
    const runLogPath = path.join(
      config.workspace.root,
      config.autoresearch.workspace_name,
      "run.log",
    );

    // Pre-compile regexes from metrics config.
    // Summary fields use the convention `name: value` parsed from the whole log.
    const summarySpecs: Array<{ name: string; regex: RegExp; type: string }> = [];
    const { primary, summary_fields, progress_line } = config.autoresearch.metrics;
    // primary metric appears in summary block as `<name>: <number>`
    summarySpecs.push({
      name: primary.name,
      regex: new RegExp(`${escapeRegex(primary.name)}:\\s+([\\d.]+)`),
      type: "float",
    });
    for (const sf of summary_fields) {
      summarySpecs.push({
        name: sf.name,
        regex: new RegExp(`${escapeRegex(sf.name)}:\\s+([\\d.,]+)`),
        type: sf.type,
      });
    }

    // Progress-line fields come from user-declared regex patterns.
    const progressSpecs: Array<{ name: string; regex: RegExp; type: string }> = [];
    for (const pl of progress_line) {
      try {
        progressSpecs.push({ name: pl.name, regex: new RegExp(pl.pattern), type: pl.type });
      } catch {
        // Invalid regex already reported by validation; skip.
      }
    }

    const parseFieldValue = (raw: string, type: string): number => {
      if (type === "int") return parseInt(raw, 10);
      if (type === "int_commas") return parseInt(raw.replace(/,/g, ""), 10);
      return parseFloat(raw);
    };

    this.trainingPollTimer = setInterval(() => {
      try {
        if (!fs.existsSync(runLogPath)) return;
        const content = fs.readFileSync(runLogPath, "utf-8");
        // run.log uses \r for in-place updates — take the last line from \r-split
        const lines = content.split(/[\r\n]+/).filter((l) => l.trim());
        if (lines.length === 0) return;

        const fields: Record<string, number> = {};

        // Summary block fields (full content scan)
        for (const spec of summarySpecs) {
          const m = content.match(spec.regex);
          if (m) {
            const v = parseFieldValue(m[1], spec.type);
            if (Number.isFinite(v)) fields[spec.name] = v;
          }
        }

        // Progress-line fields (last line only)
        const lastLine = lines[lines.length - 1];
        for (const spec of progressSpecs) {
          const m = lastLine.match(spec.regex);
          if (m) {
            const v = parseFieldValue(m[1], spec.type);
            if (Number.isFinite(v)) fields[spec.name] = v;
          }
        }

        this.trainingMetrics = {
          fields,
          updated_at: new Date().toISOString(),
        };

        // Append to loss history for charting (deduplicate by step).
        // "step" and "loss" are conventional field names; if either is
        // missing from the user's progress_line config, we skip charting.
        const step = fields["step"];
        const loss = fields["loss"];
        if (step !== undefined && loss !== undefined) {
          const last = this.lossHistory[this.lossHistory.length - 1];
          // Detect new experiment when step resets to a lower value
          if (last && step < last.step - 10) {
            this.currentExperiment++;
          }
          if (!last || last.step !== step || last.experiment !== this.currentExperiment) {
            this.lossHistory.push({ step, loss, timestamp: new Date().toISOString(), experiment: this.currentExperiment });
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

/**
 * Training metrics parsed from run.log. Field keys come from the user's
 * metrics config (nanochat defaults produce val_bpb/peak_vram_mb/loss/etc).
 */
export interface TrainingMetrics {
  fields: Record<string, number>;
  updated_at: string;
}

/**
 * One row from results.tsv, normalized. `row` carries every column by name
 * (for generic table rendering); `metric` is the parsed primary-metric
 * number (NaN if unparseable); status/commit/description are the schema-
 * configured columns surfaced for convenient access.
 */
export interface ExperimentResult {
  commit: string;
  status: string;
  description: string;
  metric: number;
  row: Record<string, string>;
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
  loss_history: Array<{ step: number; loss: number; timestamp: string; experiment: number }>;
  hardware: HardwareMetrics | null;
  instruction: { status: string; message?: string; submitted_at?: string; delivered_at?: string };
  autoresearch_metrics: MetricsConfig | null;
  autoresearch_schema: ResultsSchema | null;
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
