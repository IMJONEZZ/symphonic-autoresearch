import { describe, it, expect } from "vitest";
import { sortForDispatch, shouldDispatch } from "../../../src/orchestrator/dispatch.js";
import type { Issue } from "../../../src/types/issue.js";
import type { OrchestratorState } from "../../../src/types/orchestrator.js";
import type { ServiceConfig } from "../../../src/types/workflow.js";
import { buildServiceConfig } from "../../../src/config/config-layer.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "id1",
    identifier: "MT-1",
    title: "Test Issue",
    description: null,
    priority: null,
    state: "Todo",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: new Date("2025-01-01"),
    updated_at: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    poll_interval_ms: 30000,
    max_concurrent_agents: 10,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    agent_totals: { experiments_run: 0, seconds_running: 0, crash_restarts: 0 },
    ...overrides,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}): ServiceConfig {
  return buildServiceConfig({
    tracker: {
      kind: "linear",
      api_key: "test",
      project_slug: "proj",
    },
    ...overrides,
  });
}

describe("sortForDispatch", () => {
  it("sorts by priority ascending, null last", () => {
    const issues = [
      makeIssue({ id: "a", priority: 3 }),
      makeIssue({ id: "b", priority: 1 }),
      makeIssue({ id: "c", priority: null }),
      makeIssue({ id: "d", priority: 2 }),
    ];
    const sorted = sortForDispatch(issues);
    expect(sorted.map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("sorts by created_at for same priority", () => {
    const issues = [
      makeIssue({ id: "a", priority: 1, created_at: new Date("2025-03-01") }),
      makeIssue({ id: "b", priority: 1, created_at: new Date("2025-01-01") }),
    ];
    const sorted = sortForDispatch(issues);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("uses identifier as tie-breaker", () => {
    const issues = [
      makeIssue({ id: "a", identifier: "MT-2", priority: 1, created_at: new Date("2025-01-01") }),
      makeIssue({ id: "b", identifier: "MT-1", priority: 1, created_at: new Date("2025-01-01") }),
    ];
    const sorted = sortForDispatch(issues);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("shouldDispatch", () => {
  it("dispatches eligible active issue", () => {
    expect(shouldDispatch(makeIssue(), makeState(), makeConfig())).toBe(true);
  });

  it("rejects issue missing required fields", () => {
    expect(shouldDispatch(makeIssue({ id: "" }), makeState(), makeConfig())).toBe(false);
    expect(shouldDispatch(makeIssue({ title: "" }), makeState(), makeConfig())).toBe(false);
  });

  it("rejects issue not in active states", () => {
    expect(
      shouldDispatch(makeIssue({ state: "Backlog" }), makeState(), makeConfig()),
    ).toBe(false);
  });

  it("rejects issue in terminal state", () => {
    expect(
      shouldDispatch(makeIssue({ state: "Done" }), makeState(), makeConfig()),
    ).toBe(false);
  });

  it("rejects already running issue", () => {
    const state = makeState();
    state.running.set("id1", {} as any);
    expect(shouldDispatch(makeIssue(), state, makeConfig())).toBe(false);
  });

  it("rejects already claimed issue", () => {
    const state = makeState();
    state.claimed.add("id1");
    expect(shouldDispatch(makeIssue(), state, makeConfig())).toBe(false);
  });

  it("rejects when global slots full", () => {
    const state = makeState({ max_concurrent_agents: 0 });
    expect(shouldDispatch(makeIssue(), state, makeConfig())).toBe(false);
  });

  it("rejects Todo issue with non-terminal blockers", () => {
    const issue = makeIssue({
      state: "Todo",
      blocked_by: [{ id: "blocker1", identifier: "MT-99", state: "In Progress" }],
    });
    expect(shouldDispatch(issue, makeState(), makeConfig())).toBe(false);
  });

  it("allows Todo issue with terminal blockers", () => {
    const issue = makeIssue({
      state: "Todo",
      blocked_by: [{ id: "blocker1", identifier: "MT-99", state: "Done" }],
    });
    expect(shouldDispatch(issue, makeState(), makeConfig())).toBe(true);
  });

  it("respects per-state concurrency limits", () => {
    const config = makeConfig({
      agent: { max_concurrent_agents_by_state: { todo: 1 } },
    });
    const state = makeState();
    state.running.set("other", { issue: makeIssue({ id: "other", state: "Todo" }) } as any);
    expect(
      shouldDispatch(makeIssue({ id: "new" }), state, config),
    ).toBe(false);
  });
});
