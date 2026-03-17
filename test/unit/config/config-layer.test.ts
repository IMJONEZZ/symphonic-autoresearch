import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServiceConfig } from "../../../src/config/config-layer.js";
import os from "node:os";
import path from "node:path";

describe("buildServiceConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LINEAR_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("applies defaults for empty config", () => {
    const config = buildServiceConfig({});
    expect(config.mode).toBe("linear");
    expect(config.polling.interval_ms).toBe(30000);
    expect(config.agent.max_concurrent_agents).toBe(10);
    expect(config.agent.max_turns).toBe(20);
    expect(config.agent.max_retry_backoff_ms).toBe(300000);
    expect(config.opencode.command).toBe("opencode");
    expect(config.opencode.stall_timeout_ms).toBe(300000);
    expect(config.hooks.timeout_ms).toBe(60000);
    expect(config.workspace.root).toBe(path.join(os.tmpdir(), "symphony_workspaces"));
  });

  it("reads tracker config", () => {
    const config = buildServiceConfig({
      tracker: {
        kind: "linear",
        api_key: "$LINEAR_API_KEY",
        project_slug: "my-project",
      },
    });
    expect(config.tracker.kind).toBe("linear");
    expect(config.tracker.api_key).toBe("test-key");
    expect(config.tracker.project_slug).toBe("my-project");
    expect(config.tracker.endpoint).toBe("https://api.linear.app/graphql");
  });

  it("uses default active and terminal states", () => {
    const config = buildServiceConfig({});
    expect(config.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(config.tracker.terminal_states).toContain("Done");
    expect(config.tracker.terminal_states).toContain("Cancelled");
  });

  it("parses comma-separated state strings", () => {
    const config = buildServiceConfig({
      tracker: { active_states: "Ready, Working" },
    });
    expect(config.tracker.active_states).toEqual(["Ready", "Working"]);
  });

  it("parses per-state concurrency limits", () => {
    const config = buildServiceConfig({
      agent: {
        max_concurrent_agents_by_state: {
          "Todo": 2,
          "In Progress": "3",
          "Bad": -1,
        },
      },
    });
    expect(config.agent.max_concurrent_agents_by_state["todo"]).toBe(2);
    expect(config.agent.max_concurrent_agents_by_state["in progress"]).toBe(3);
    expect(config.agent.max_concurrent_agents_by_state["bad"]).toBeUndefined();
  });

  it("falls back to default for non-positive hook timeout", () => {
    const config = buildServiceConfig({
      hooks: { timeout_ms: -1 },
    });
    expect(config.hooks.timeout_ms).toBe(60000);
  });

  it("resolves workspace root with ~", () => {
    const config = buildServiceConfig({
      workspace: { root: "~/my_workspaces" },
    });
    expect(config.workspace.root).toBe(path.join(os.homedir(), "my_workspaces"));
  });

  it("reads server port", () => {
    const config = buildServiceConfig({
      server: { port: 8080 },
    });
    expect(config.server.port).toBe(8080);
  });

  it("sets server port to null when not configured", () => {
    const config = buildServiceConfig({});
    expect(config.server.port).toBeNull();
  });

  it("coerces string integers", () => {
    const config = buildServiceConfig({
      polling: { interval_ms: "5000" },
      agent: { max_concurrent_agents: "3" },
    });
    expect(config.polling.interval_ms).toBe(5000);
    expect(config.agent.max_concurrent_agents).toBe(3);
  });

  it("reads autoresearch mode", () => {
    const config = buildServiceConfig({
      mode: "autoresearch",
      autoresearch: {
        program_md: "./program.md",
        run_tag: "test1",
        restart_on_crash: false,
      },
    });
    expect(config.mode).toBe("autoresearch");
    expect(config.autoresearch.program_md).toBe("./program.md");
    expect(config.autoresearch.run_tag).toBe("test1");
    expect(config.autoresearch.restart_on_crash).toBe(false);
  });

  it("reads opencode config", () => {
    const config = buildServiceConfig({
      opencode: {
        command: "opencode",
        model: "lmstudio/minimax-m2.5-mlx@4bit",
        agent: "build",
        run_timeout_ms: 0,
      },
    });
    expect(config.opencode.command).toBe("opencode");
    expect(config.opencode.model).toBe("lmstudio/minimax-m2.5-mlx@4bit");
    expect(config.opencode.agent).toBe("build");
    expect(config.opencode.run_timeout_ms).toBe(0);
  });
});
