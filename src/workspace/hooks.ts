import { spawn } from "node:child_process";
import type { HookName } from "../types/workspace.js";
import type { Logger } from "../logging/logger.js";

/**
 * Run a workspace hook script with timeout.
 * Executes via bash -lc in the given cwd.
 */
export async function runHook(
  name: HookName,
  script: string,
  cwd: string,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  logger.info({ hook: name, cwd }, `Running ${name} hook`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn("bash", ["-lc", script], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Truncate to avoid memory issues
      if (stdout.length > 10000) stdout = stdout.slice(-10000);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 10000) stderr = stderr.slice(-10000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
      reject(new Error(`Hook ${name} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        logger.info({ hook: name }, `Hook ${name} completed successfully`);
        resolve();
      } else {
        const msg = `Hook ${name} exited with code ${code}`;
        logger.error({ hook: name, code, stderr: stderr.slice(0, 500) }, msg);
        reject(new Error(msg));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      logger.error({ hook: name, err }, `Hook ${name} failed to spawn`);
      reject(err);
    });
  });
}

/**
 * Run a hook best-effort: log failures but don't throw.
 */
export async function runHookBestEffort(
  name: HookName,
  script: string,
  cwd: string,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  try {
    await runHook(name, script, cwd, timeoutMs, logger);
  } catch (err) {
    logger.warn(
      { hook: name, err },
      `Hook ${name} failed (best-effort, continuing)`,
    );
  }
}
