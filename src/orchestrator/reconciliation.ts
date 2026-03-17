import type { OrchestratorState } from "../types/orchestrator.js";
import type { ServiceConfig } from "../types/workflow.js";
import type { TrackerClient } from "../tracker/tracker-client.js";
import type { Logger } from "../logging/logger.js";

export interface ReconciliationActions {
  terminate: Array<{ issueId: string; cleanWorkspace: boolean }>;
  updateIssues: Array<{ issueId: string; issue: import("../types/issue.js").Issue }>;
  stallKills: string[];
}

/**
 * Detect stalled runs per Section 8.5 Part A.
 */
export function detectStalledRuns(
  state: OrchestratorState,
  stallTimeoutMs: number,
): string[] {
  if (stallTimeoutMs <= 0) return [];

  const now = Date.now();
  const stalled: string[] = [];

  for (const [issueId, entry] of state.running) {
    const lastActivity = entry.last_timestamp ?? entry.started_at;
    const elapsed = now - lastActivity.getTime();
    if (elapsed > stallTimeoutMs) {
      stalled.push(issueId);
    }
  }

  return stalled;
}

/**
 * Reconcile running issues against tracker state per Section 8.5 Part B.
 */
export async function reconcileTrackerStates(
  state: OrchestratorState,
  config: ServiceConfig,
  trackerClient: TrackerClient,
  logger: Logger,
): Promise<ReconciliationActions> {
  const actions: ReconciliationActions = {
    terminate: [],
    updateIssues: [],
    stallKills: [],
  };

  const runningIds = Array.from(state.running.keys());
  if (runningIds.length === 0) return actions;

  let refreshed;
  try {
    refreshed = await trackerClient.fetchIssueStatesByIds(runningIds);
  } catch (err) {
    logger.debug({ err }, "State refresh failed, keeping workers running");
    return actions;
  }

  const refreshedMap = new Map(refreshed.map((i) => [i.id, i]));
  const terminalStates = config.tracker.terminal_states.map((s) => s.trim().toLowerCase());
  const activeStates = config.tracker.active_states.map((s) => s.trim().toLowerCase());

  for (const issueId of runningIds) {
    const issue = refreshedMap.get(issueId);
    if (!issue) continue; // Issue not returned - keep running

    const normalizedState = issue.state.trim().toLowerCase();

    if (terminalStates.includes(normalizedState)) {
      actions.terminate.push({ issueId, cleanWorkspace: true });
    } else if (activeStates.includes(normalizedState)) {
      actions.updateIssues.push({ issueId, issue });
    } else {
      // Neither active nor terminal - stop without cleanup
      actions.terminate.push({ issueId, cleanWorkspace: false });
    }
  }

  return actions;
}
