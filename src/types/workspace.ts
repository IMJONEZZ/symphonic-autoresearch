export interface Workspace {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

export type HookName = "after_create" | "before_run" | "after_run" | "before_remove";
