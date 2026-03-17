import type { Issue } from "../types/issue.js";
import type { OrchestratorState } from "../types/orchestrator.js";
import type { ServiceConfig } from "../types/workflow.js";

/**
 * Sort issues for dispatch priority per Section 8.2.
 * 1. priority ascending (1..4 preferred; null/unknown sorts last)
 * 2. created_at oldest first
 * 3. identifier lexicographic tie-breaker
 */
export function sortForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority: lower is higher priority, null sorts last
    const ap = a.priority ?? Infinity;
    const bp = b.priority ?? Infinity;
    if (ap !== bp) return ap - bp;

    // Created at: oldest first
    const at = a.created_at?.getTime() ?? Infinity;
    const bt = b.created_at?.getTime() ?? Infinity;
    if (at !== bt) return at - bt;

    // Identifier: lexicographic
    return a.identifier.localeCompare(b.identifier);
  });
}

/**
 * Check if an issue is eligible for dispatch per Section 8.2.
 */
export function shouldDispatch(
  issue: Issue,
  state: OrchestratorState,
  config: ServiceConfig,
): boolean {
  // Must have required fields
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  const normalizedState = issue.state.trim().toLowerCase();
  const activeStates = config.tracker.active_states.map((s) => s.trim().toLowerCase());
  const terminalStates = config.tracker.terminal_states.map((s) => s.trim().toLowerCase());

  // Must be active and not terminal
  if (!activeStates.includes(normalizedState)) return false;
  if (terminalStates.includes(normalizedState)) return false;

  // Must not be already running or claimed
  if (state.running.has(issue.id)) return false;
  if (state.claimed.has(issue.id)) return false;

  // Check global concurrency
  if (state.running.size >= state.max_concurrent_agents) return false;

  // Check per-state concurrency
  const stateLimit = config.agent.max_concurrent_agents_by_state[normalizedState];
  if (stateLimit !== undefined) {
    const runningInState = Array.from(state.running.values()).filter(
      (r) => r.issue.state.trim().toLowerCase() === normalizedState,
    ).length;
    if (runningInState >= stateLimit) return false;
  }

  // Blocker rule for Todo state
  if (normalizedState === "todo") {
    const hasNonTerminalBlocker = issue.blocked_by.some((blocker) => {
      if (!blocker.state) return true; // unknown state = non-terminal
      return !terminalStates.includes(blocker.state.trim().toLowerCase());
    });
    if (hasNonTerminalBlocker) return false;
  }

  return true;
}

/**
 * Check if there are available global slots.
 */
export function hasAvailableSlots(state: OrchestratorState): boolean {
  return state.running.size < state.max_concurrent_agents;
}
