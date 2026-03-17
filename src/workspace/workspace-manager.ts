import fs from "node:fs";
import path from "node:path";
import { sanitizeWorkspaceKey, isContainedIn } from "../utils/index.js";
import { WorkspaceError } from "../types/errors.js";
import type { Workspace, HookName } from "../types/workspace.js";
import type { HooksConfig } from "../types/workflow.js";
import { runHook, runHookBestEffort } from "./hooks.js";
import type { Logger } from "../logging/logger.js";

export class WorkspaceManager {
  constructor(
    private getRoot: () => string,
    private getHooks: () => HooksConfig,
    private logger: Logger,
  ) {}

  /**
   * Ensure a workspace exists for the given issue identifier.
   * Creates the directory if needed and runs after_create hook.
   */
  async ensureWorkspace(identifier: string): Promise<Workspace> {
    const root = path.resolve(this.getRoot());
    const workspaceKey = sanitizeWorkspaceKey(identifier);
    const workspacePath = path.join(root, workspaceKey);

    // Safety invariant: workspace path must be inside workspace root
    if (!isContainedIn(workspacePath, root)) {
      throw new WorkspaceError(
        "invalid_workspace_path",
        `Workspace path ${workspacePath} is outside workspace root ${root}`,
      );
    }

    // Ensure root directory exists
    fs.mkdirSync(root, { recursive: true });

    let createdNow = false;

    // Check if path exists
    if (fs.existsSync(workspacePath)) {
      const stat = fs.statSync(workspacePath);
      if (!stat.isDirectory()) {
        // Not a directory - remove and recreate
        fs.rmSync(workspacePath);
        fs.mkdirSync(workspacePath, { recursive: true });
        createdNow = true;
      }
    } else {
      fs.mkdirSync(workspacePath, { recursive: true });
      createdNow = true;
    }

    const hooks = this.getHooks();

    // Run after_create hook only when newly created
    if (createdNow && hooks.after_create) {
      try {
        await runHook(
          "after_create",
          hooks.after_create,
          workspacePath,
          hooks.timeout_ms,
          this.logger,
        );
      } catch (err) {
        // after_create failure is fatal to workspace creation - clean up
        try {
          fs.rmSync(workspacePath, { recursive: true, force: true });
        } catch {
          // ignore cleanup failure
        }
        throw new WorkspaceError(
          "hook_failure",
          `after_create hook failed for ${identifier}`,
          err,
        );
      }
    }

    return {
      path: workspacePath,
      workspace_key: workspaceKey,
      created_now: createdNow,
    };
  }

  /**
   * Run the before_run hook for a workspace.
   */
  async runBeforeRun(workspacePath: string): Promise<void> {
    const hooks = this.getHooks();
    if (hooks.before_run) {
      await runHook(
        "before_run",
        hooks.before_run,
        workspacePath,
        hooks.timeout_ms,
        this.logger,
      );
    }
  }

  /**
   * Run the after_run hook for a workspace (best-effort).
   */
  async runAfterRun(workspacePath: string): Promise<void> {
    const hooks = this.getHooks();
    if (hooks.after_run) {
      await runHookBestEffort(
        "after_run",
        hooks.after_run,
        workspacePath,
        hooks.timeout_ms,
        this.logger,
      );
    }
  }

  /**
   * Clean a workspace directory, running before_remove hook first.
   */
  async cleanWorkspace(identifier: string): Promise<void> {
    const root = path.resolve(this.getRoot());
    const workspaceKey = sanitizeWorkspaceKey(identifier);
    const workspacePath = path.join(root, workspaceKey);

    if (!isContainedIn(workspacePath, root)) {
      this.logger.error(
        { identifier, workspacePath },
        "Refusing to clean workspace outside root",
      );
      return;
    }

    if (!fs.existsSync(workspacePath)) return;

    const hooks = this.getHooks();
    if (hooks.before_remove) {
      await runHookBestEffort(
        "before_remove",
        hooks.before_remove,
        workspacePath,
        hooks.timeout_ms,
        this.logger,
      );
    }

    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      this.logger.info({ identifier }, "Workspace cleaned");
    } catch (err) {
      this.logger.error({ identifier, err }, "Failed to remove workspace");
    }
  }
}
