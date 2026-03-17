/**
 * Sanitize an issue identifier for use as a workspace directory name.
 * Only [A-Za-z0-9._-] are allowed; all other characters become _.
 */
export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}
