import type { OrchestratorState, RetryEntry } from "../types/orchestrator.js";

/**
 * Schedule a retry for an issue.
 * Cancels any existing retry timer for the same issue.
 */
export function scheduleRetry(
  state: OrchestratorState,
  issueId: string,
  attempt: number,
  opts: {
    identifier: string;
    error?: string;
    delayType?: "continuation" | "backoff";
    maxBackoffMs?: number;
  },
  onTimer: (issueId: string) => void,
): OrchestratorState {
  // Cancel existing retry timer
  const existing = state.retry_attempts.get(issueId);
  if (existing) {
    clearTimeout(existing.timer_handle);
  }

  // Compute delay
  let delayMs: number;
  if (opts.delayType === "continuation") {
    delayMs = 1000; // Short fixed delay for continuation
  } else {
    const maxBackoff = opts.maxBackoffMs ?? 300000;
    delayMs = Math.min(10000 * Math.pow(2, attempt - 1), maxBackoff);
  }

  const dueAtMs = Date.now() + delayMs;

  const timerHandle = setTimeout(() => {
    onTimer(issueId);
  }, delayMs);

  const entry: RetryEntry = {
    issue_id: issueId,
    identifier: opts.identifier,
    attempt,
    due_at_ms: dueAtMs,
    timer_handle: timerHandle,
    error: opts.error ?? null,
  };

  state.retry_attempts.set(issueId, entry);
  // Keep issue claimed during retry
  state.claimed.add(issueId);

  return state;
}

/**
 * Compute the next attempt number from a running entry's retry_attempt.
 */
export function nextAttempt(current: number | null): number {
  if (current === null) return 1;
  return current + 1;
}

/**
 * Cancel all retry timers (for shutdown).
 */
export function cancelAllRetries(state: OrchestratorState): void {
  for (const entry of state.retry_attempts.values()) {
    clearTimeout(entry.timer_handle);
  }
  state.retry_attempts.clear();
}
