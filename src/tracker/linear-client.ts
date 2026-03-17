import type { Issue, BlockerRef } from "../types/issue.js";
import type { TrackerConfig } from "../types/workflow.js";
import { TrackerError } from "../types/errors.js";
import type { TrackerClient } from "./tracker-client.js";
import {
  CANDIDATE_ISSUES_QUERY,
  ISSUES_BY_STATES_QUERY,
  ISSUE_STATES_BY_IDS_QUERY,
} from "./linear-queries.js";
import type { Logger } from "../logging/logger.js";

const NETWORK_TIMEOUT = 30000;

export class LinearClient implements TrackerClient {
  constructor(
    private getConfig: () => TrackerConfig,
    private logger: Logger,
  ) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    const config = this.getConfig();
    const allIssues: Issue[] = [];
    let after: string | null = null;

    while (true) {
      const variables: Record<string, unknown> = {
        projectSlug: config.project_slug,
        stateNames: config.active_states,
      };
      if (after) variables.after = after;

      const data = await this.graphql(CANDIDATE_ISSUES_QUERY, variables);
      const issues = data?.issues;
      if (!issues?.nodes) {
        throw new TrackerError(
          "linear_unknown_payload",
          "Unexpected Linear API response shape for candidate issues",
        );
      }

      for (const node of issues.nodes) {
        allIssues.push(normalizeIssue(node));
      }

      if (issues.pageInfo?.hasNextPage) {
        if (!issues.pageInfo.endCursor) {
          throw new TrackerError(
            "linear_missing_end_cursor",
            "Linear pagination missing endCursor",
          );
        }
        after = issues.pageInfo.endCursor;
      } else {
        break;
      }
    }

    return allIssues;
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) return [];

    const config = this.getConfig();
    const allIssues: Issue[] = [];
    let after: string | null = null;

    while (true) {
      const variables: Record<string, unknown> = {
        projectSlug: config.project_slug,
        stateNames,
      };
      if (after) variables.after = after;

      const data = await this.graphql(ISSUES_BY_STATES_QUERY, variables);
      const issues = data?.issues;
      if (!issues?.nodes) {
        throw new TrackerError(
          "linear_unknown_payload",
          "Unexpected Linear API response shape for issues by states",
        );
      }

      for (const node of issues.nodes) {
        allIssues.push(normalizeMinimalIssue(node));
      }

      if (issues.pageInfo?.hasNextPage) {
        if (!issues.pageInfo.endCursor) {
          throw new TrackerError(
            "linear_missing_end_cursor",
            "Linear pagination missing endCursor",
          );
        }
        after = issues.pageInfo.endCursor;
      } else {
        break;
      }
    }

    return allIssues;
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    if (issueIds.length === 0) return [];

    const data = await this.graphql(ISSUE_STATES_BY_IDS_QUERY, {
      ids: issueIds,
    });
    const issues = data?.issues;
    if (!issues?.nodes) {
      throw new TrackerError(
        "linear_unknown_payload",
        "Unexpected Linear API response shape for issue states by IDs",
      );
    }

    return issues.nodes.map(normalizeIssue);
  }

  /** Execute a raw GraphQL query against Linear (also used by linear_graphql tool). */
  async graphql(
    query: string,
    variables?: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const config = this.getConfig();

    if (!config.api_key) {
      throw new TrackerError(
        "missing_tracker_api_key",
        "Linear API key is not configured",
      );
    }

    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: config.api_key,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(NETWORK_TIMEOUT),
      });
    } catch (err) {
      throw new TrackerError(
        "linear_api_request",
        `Linear API request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!response.ok) {
      throw new TrackerError(
        "linear_api_status",
        `Linear API returned status ${response.status}`,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      throw new TrackerError(
        "linear_unknown_payload",
        "Failed to parse Linear API response as JSON",
        err,
      );
    }

    if (body.errors) {
      throw new TrackerError(
        "linear_graphql_errors",
        `Linear GraphQL errors: ${JSON.stringify(body.errors)}`,
      );
    }

    return (body.data as any) ?? {};
  }
}

// --- Normalization ---

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeIssue(node: any): Issue {
  const blockers: BlockerRef[] = [];

  // Inverse relations where type is "blocks" means the related issue blocks this one
  if (node.inverseRelations?.nodes) {
    for (const rel of node.inverseRelations.nodes) {
      if (rel.type === "blocks" && rel.issue) {
        blockers.push({
          id: rel.issue.id ?? null,
          identifier: rel.issue.identifier ?? null,
          state: rel.issue.state?.name ?? null,
        });
      }
    }
  }

  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title ?? "",
    description: node.description ?? null,
    priority: typeof node.priority === "number" ? node.priority : null,
    state: node.state?.name ?? "",
    branch_name: node.branchName ?? null,
    url: node.url ?? null,
    labels: (node.labels?.nodes ?? []).map((l: any) =>
      (l.name ?? "").toLowerCase(),
    ),
    blocked_by: blockers,
    created_at: node.createdAt ? new Date(node.createdAt) : null,
    updated_at: node.updatedAt ? new Date(node.updatedAt) : null,
  };
}

function normalizeMinimalIssue(node: any): Issue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: "",
    description: null,
    priority: null,
    state: node.state?.name ?? "",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
  };
}
