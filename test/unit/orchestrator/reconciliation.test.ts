import { describe, it, expect } from "vitest";
import { detectStalledRuns } from "../../../src/orchestrator/reconciliation.js";
import type { OrchestratorState, RunningEntry } from "../../../src/types/orchestrator.js";

function makeState(): OrchestratorState {
  return {
    poll_interval_ms: 30000,
    max_concurrent_agents: 10,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    agent_totals: { experiments_run: 0, seconds_running: 0, crash_restarts: 0 },
  };
}

describe("detectStalledRuns", () => {
  it("returns empty when no runs", () => {
    expect(detectStalledRuns(makeState(), 300000)).toEqual([]);
  });

  it("skips stall detection when timeout <= 0", () => {
    const state = makeState();
    state.running.set("id1", {
      started_at: new Date(Date.now() - 1000000),
      last_timestamp: null,
    } as RunningEntry);
    expect(detectStalledRuns(state, 0)).toEqual([]);
    expect(detectStalledRuns(state, -1)).toEqual([]);
  });

  it("detects stalled run based on started_at when no events", () => {
    const state = makeState();
    state.running.set("id1", {
      started_at: new Date(Date.now() - 400000),
      last_timestamp: null,
    } as RunningEntry);
    expect(detectStalledRuns(state, 300000)).toEqual(["id1"]);
  });

  it("detects stalled run based on last event timestamp", () => {
    const state = makeState();
    state.running.set("id1", {
      started_at: new Date(Date.now() - 1000),
      last_timestamp: new Date(Date.now() - 400000),
    } as RunningEntry);
    expect(detectStalledRuns(state, 300000)).toEqual(["id1"]);
  });

  it("does not flag active run", () => {
    const state = makeState();
    state.running.set("id1", {
      started_at: new Date(Date.now() - 1000),
      last_timestamp: new Date(Date.now() - 1000),
    } as RunningEntry);
    expect(detectStalledRuns(state, 300000)).toEqual([]);
  });
});
