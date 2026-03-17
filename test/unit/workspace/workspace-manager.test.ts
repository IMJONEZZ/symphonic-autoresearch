import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceManager } from "../../../src/workspace/workspace-manager.js";
import pino from "pino";

const logger = pino({ level: "silent" });

describe("WorkspaceManager", () => {
  let testRoot: string;
  let manager: WorkspaceManager;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-test-"));
    manager = new WorkspaceManager(
      () => testRoot,
      () => ({
        after_create: null,
        before_run: null,
        after_run: null,
        before_remove: null,
        timeout_ms: 5000,
      }),
      logger,
    );
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("creates workspace for new identifier", async () => {
    const workspace = await manager.ensureWorkspace("MT-42");
    expect(workspace.created_now).toBe(true);
    expect(workspace.workspace_key).toBe("MT-42");
    expect(fs.existsSync(workspace.path)).toBe(true);
  });

  it("reuses existing workspace", async () => {
    await manager.ensureWorkspace("MT-42");
    const workspace = await manager.ensureWorkspace("MT-42");
    expect(workspace.created_now).toBe(false);
  });

  it("sanitizes workspace key", async () => {
    const workspace = await manager.ensureWorkspace("Team/Project#123");
    expect(workspace.workspace_key).toBe("Team_Project_123");
  });

  it("deterministic path per identifier", async () => {
    const w1 = await manager.ensureWorkspace("MT-1");
    const w2 = await manager.ensureWorkspace("MT-1");
    expect(w1.path).toBe(w2.path);
  });

  it("handles path traversal attempts safely via sanitization", async () => {
    // The sanitizer replaces / with _, so path traversal is neutralized
    const workspace = await manager.ensureWorkspace("../../etc/passwd");
    expect(workspace.workspace_key).toBe(".._.._etc_passwd");
    expect(workspace.path.startsWith(testRoot)).toBe(true);
    expect(fs.existsSync(workspace.path)).toBe(true);
  });

  it("cleans workspace", async () => {
    const workspace = await manager.ensureWorkspace("MT-42");
    expect(fs.existsSync(workspace.path)).toBe(true);

    await manager.cleanWorkspace("MT-42");
    expect(fs.existsSync(workspace.path)).toBe(false);
  });

  it("clean is no-op for nonexistent workspace", async () => {
    await expect(manager.cleanWorkspace("nonexistent")).resolves.not.toThrow();
  });
});
