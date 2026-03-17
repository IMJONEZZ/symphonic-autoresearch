import { describe, it, expect, vi, afterEach } from "vitest";
import { scheduleRetry, nextAttempt } from "../../../src/orchestrator/retry.js";
import type { OrchestratorState } from "../../../src/types/orchestrator.js";

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

describe("scheduleRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a retry entry with continuation delay", () => {
    vi.useFakeTimers();
    const state = makeState();
    const onTimer = vi.fn();

    scheduleRetry(state, "issue1", 1, {
      identifier: "MT-1",
      delayType: "continuation",
    }, onTimer);

    expect(state.retry_attempts.has("issue1")).toBe(true);
    expect(state.claimed.has("issue1")).toBe(true);

    const entry = state.retry_attempts.get("issue1")!;
    expect(entry.attempt).toBe(1);
    expect(entry.identifier).toBe("MT-1");

    // Timer should fire after ~1000ms
    vi.advanceTimersByTime(1001);
    expect(onTimer).toHaveBeenCalledWith("issue1");
  });

  it("computes exponential backoff", () => {
    vi.useFakeTimers();
    const state = makeState();
    const onTimer = vi.fn();

    // attempt 1: min(10000 * 2^0, 300000) = 10000
    scheduleRetry(state, "issue1", 1, {
      identifier: "MT-1",
      delayType: "backoff",
    }, onTimer);

    const entry1 = state.retry_attempts.get("issue1")!;
    const delay1 = entry1.due_at_ms - Date.now();
    expect(delay1).toBeCloseTo(10000, -2);

    // attempt 3: min(10000 * 2^2, 300000) = 40000
    scheduleRetry(state, "issue1", 3, {
      identifier: "MT-1",
      delayType: "backoff",
    }, onTimer);

    const entry3 = state.retry_attempts.get("issue1")!;
    const delay3 = entry3.due_at_ms - Date.now();
    expect(delay3).toBeCloseTo(40000, -2);
  });

  it("caps backoff at max", () => {
    vi.useFakeTimers();
    const state = makeState();
    const onTimer = vi.fn();

    scheduleRetry(state, "issue1", 10, {
      identifier: "MT-1",
      delayType: "backoff",
      maxBackoffMs: 60000,
    }, onTimer);

    const entry = state.retry_attempts.get("issue1")!;
    const delay = entry.due_at_ms - Date.now();
    expect(delay).toBeLessThanOrEqual(60000);
  });

  it("cancels existing timer when rescheduling", () => {
    vi.useFakeTimers();
    const state = makeState();
    const onTimer = vi.fn();

    scheduleRetry(state, "issue1", 1, { identifier: "MT-1", delayType: "continuation" }, onTimer);
    scheduleRetry(state, "issue1", 2, { identifier: "MT-1", delayType: "backoff" }, onTimer);

    expect(state.retry_attempts.get("issue1")!.attempt).toBe(2);

    // Original timer shouldn't fire
    vi.advanceTimersByTime(1001);
    expect(onTimer).not.toHaveBeenCalled();
  });
});

describe("nextAttempt", () => {
  it("returns 1 for null", () => {
    expect(nextAttempt(null)).toBe(1);
  });

  it("increments existing attempt", () => {
    expect(nextAttempt(1)).toBe(2);
    expect(nextAttempt(5)).toBe(6);
  });
});
