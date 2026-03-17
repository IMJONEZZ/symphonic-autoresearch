export class SymphonyError extends Error {
  constructor(
    public code: string,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "SymphonyError";
  }
}

export class WorkflowError extends SymphonyError {
  constructor(
    code:
      | "missing_workflow_file"
      | "workflow_parse_error"
      | "workflow_front_matter_not_a_map"
      | "template_parse_error"
      | "template_render_error",
    message: string,
    cause?: unknown,
  ) {
    super(code, message, cause);
    this.name = "WorkflowError";
  }
}

export class TrackerError extends SymphonyError {
  constructor(
    code:
      | "unsupported_tracker_kind"
      | "missing_tracker_api_key"
      | "missing_tracker_project_slug"
      | "linear_api_request"
      | "linear_api_status"
      | "linear_graphql_errors"
      | "linear_unknown_payload"
      | "linear_missing_end_cursor",
    message: string,
    cause?: unknown,
  ) {
    super(code, message, cause);
    this.name = "TrackerError";
  }
}

export class WorkspaceError extends SymphonyError {
  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = "WorkspaceError";
  }
}

export class AgentError extends SymphonyError {
  constructor(
    code:
      | "opencode_not_found"
      | "invalid_workspace_cwd"
      | "run_timeout"
      | "run_failed"
      | "run_crashed"
      | "process_exit",
    message: string,
    cause?: unknown,
  ) {
    super(code, message, cause);
    this.name = "AgentError";
  }
}
