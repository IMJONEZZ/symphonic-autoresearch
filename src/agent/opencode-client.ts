import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { OpenCodeConfig } from "../types/workflow.js";
import type { AgentEvent, RunResult } from "../types/agent.js";
import { AgentError } from "../types/errors.js";
import type { Logger } from "../logging/logger.js";

export interface OpenCodeSession {
  process: ChildProcess;
  pid: string | null;
}

export type AgentUpdateCallback = (event: AgentEvent) => void;

/**
 * Client for running OpenCode as a subprocess.
 * Uses `opencode run` in non-interactive mode.
 */
export class OpenCodeClient {
  constructor(
    private getOpenCodeConfig: () => OpenCodeConfig,
    private logger: Logger,
  ) {}

  /**
   * Launch a long-running OpenCode session.
   * Spawns `opencode run` with the given prompt and lets it run autonomously.
   * Returns when the process exits.
   */
  async runSession(
    workspacePath: string,
    prompt: string,
    onUpdate: AgentUpdateCallback,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const config = this.getOpenCodeConfig();

    // Write the full prompt to a file and attach it via -f
    const promptFile = path.join(workspacePath, ".symphonic-autoresearch-prompt.md");
    fs.writeFileSync(promptFile, prompt, "utf-8");

    // Build the opencode run command
    // Use --format json for structured streaming output, --print-logs for stderr diagnostics
    const args = [
      "run",
      "Follow the instructions in the attached file exactly. Do not ask any questions - proceed autonomously.",
      "-f", promptFile,
      "--format", "json",
      "--print-logs",
    ];
    if (config.model) {
      args.push("-m", config.model);
    }
    if (config.agent) {
      args.push("--agent", config.agent);
    }

    const command = config.command || "opencode";

    this.logger.info(
      { command, args: args.join(" "), cwd: workspacePath },
      "Launching OpenCode session",
    );

    const child = spawn(command, args, {
      cwd: workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const pid = child.pid ? String(child.pid) : null;

    onUpdate({
      event: "session_started",
      timestamp: new Date(),
      agent_pid: pid,
      message: `OpenCode session started, pid=${pid}`,
    });

    // Collect stderr for diagnostics (filter out noisy delta events)
    let stderrBuffer = "";
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderrBuffer += chunk;
      // Only log lines that aren't repetitive delta/publishing noise
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes("message.part.delta") || trimmed.includes("message.part.updated")) continue;
        if (trimmed.includes("session.diff") || trimmed.includes("session.status")) continue;
        this.logger.info({ pid, stderr: trimmed.slice(0, 500) }, "opencode stderr");
      }
    });

    // Collect stdout for monitoring (JSON events from --format json)
    let stdoutBuffer = "";
    let stdoutLineBuffer = "";
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdoutBuffer += chunk;
      stdoutLineBuffer += chunk;

      // Parse complete lines (JSON events are newline-delimited)
      const lines = stdoutLineBuffer.split("\n");
      stdoutLineBuffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try to parse as JSON event from --format json
        let message = trimmed.slice(0, 500);
        let parsed: Record<string, unknown> | undefined;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Not JSON, use raw line
        }

        if (parsed && typeof parsed.type === "string") {
          const evt = parsed as Record<string, unknown>;
          const p = (evt.part ?? evt) as Record<string, unknown>;
          switch (evt.type) {
            case "text":
              message = `[text] ${(String(p.text ?? "")).slice(0, 400)}`;
              break;
            case "tool_use": {
              // Try multiple possible field names for the tool name
              const toolName = String(p.name ?? p.toolName ?? p.tool_name ?? p.tool ?? evt.name ?? "");
              const input = p.input ?? p.args ?? p.arguments;
              message = `[tool_use] ${toolName || "unknown"}${input ? ": " + JSON.stringify(input).slice(0, 300) : ""}`;
              break;
            }
            case "tool_result": {
              const resultName = String(p.name ?? p.toolName ?? p.tool_name ?? evt.name ?? "");
              const output = p.output ?? p.result ?? p.content;
              const err = p.error;
              message = `[tool_result] ${resultName}${err ? " ERROR: " + String(err) : ""}${output ? ": " + String(typeof output === "string" ? output : JSON.stringify(output)).slice(0, 300) : ""}`.slice(0, 500);
              break;
            }
            case "step_start":
              message = `[step_start]`;
              break;
            case "step_finish": {
              const tokens = p.tokens as Record<string, unknown> | undefined;
              const reason = String(p.reason ?? "");
              message = tokens
                ? `[step_finish] ${reason} (${tokens.input}in/${tokens.output}out)`
                : `[step_finish] ${reason}`;
              break;
            }
            default:
              message = `[${evt.type}] ${String(p.text ?? p.name ?? "")}`.slice(0, 500);
          }
        }

        onUpdate({
          event: "notification",
          timestamp: new Date(),
          agent_pid: pid,
          message,
          raw: parsed,
        });
      }
    });

    // Handle abort signal
    const onAbort = () => {
      if (!child.killed) {
        this.logger.info({ pid }, "Aborting OpenCode session");
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    // Set up run timeout
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (config.run_timeout_ms > 0) {
      timeoutHandle = setTimeout(() => {
        this.logger.warn({ pid, timeout_ms: config.run_timeout_ms }, "OpenCode session timed out");
        onAbort();
      }, config.run_timeout_ms);
    }

    // Wait for process to exit
    return new Promise<RunResult>((resolve) => {
      child.on("close", (code, sig) => {
        signal.removeEventListener("abort", onAbort);
        if (timeoutHandle) clearTimeout(timeoutHandle);

        const exitCode = code ?? -1;

        if (signal.aborted) {
          resolve({
            success: false,
            event: "run_failed",
            error: "Aborted",
            exit_code: exitCode,
          });
          return;
        }

        if (exitCode === 0) {
          onUpdate({
            event: "run_completed",
            timestamp: new Date(),
            agent_pid: pid,
            message: "OpenCode session completed successfully",
          });
          resolve({
            success: true,
            event: "run_completed",
            exit_code: 0,
          });
        } else {
          const errorMsg = stderrBuffer.trim().slice(-500) || `Exit code ${exitCode}, signal ${sig}`;
          onUpdate({
            event: "run_failed",
            timestamp: new Date(),
            agent_pid: pid,
            message: errorMsg,
          });
          resolve({
            success: false,
            event: "run_failed",
            error: errorMsg,
            exit_code: exitCode,
          });
        }
      });

      child.on("error", (err) => {
        signal.removeEventListener("abort", onAbort);
        if (timeoutHandle) clearTimeout(timeoutHandle);

        onUpdate({
          event: "run_crashed",
          timestamp: new Date(),
          agent_pid: pid,
          message: err.message,
        });
        resolve({
          success: false,
          event: "run_crashed",
          error: err.message,
          exit_code: -1,
        });
      });
    });
  }

  /**
   * Kill a running session.
   */
  killSession(session: OpenCodeSession): void {
    try {
      if (session.process && !session.process.killed) {
        session.process.kill("SIGTERM");
        setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill("SIGKILL");
          }
        }, 5000);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
