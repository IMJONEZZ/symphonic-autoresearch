import path from "node:path";
import os from "node:os";

/**
 * Expand ~ to home directory and resolve $VAR for path values.
 * Only applies to values intended as filesystem paths (contains path separators or ~).
 */
export function expandPath(p: string): string {
  if (p.startsWith("~")) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (p.startsWith("$")) {
    const varName = p.slice(1).split(path.sep)[0];
    const resolved = process.env[varName] ?? "";
    if (resolved) {
      p = p.replace(`$${varName}`, resolved);
    }
  }
  // If path contains separators, resolve to absolute
  if (p.includes(path.sep) || p.includes("/")) {
    return path.resolve(p);
  }
  // Bare strings without path separators are preserved as-is
  return p;
}

/**
 * Check that child path is contained within parent path.
 * Both paths are normalized to absolute before comparison.
 */
export function isContainedIn(child: string, parent: string): boolean {
  const absChild = path.resolve(child) + path.sep;
  const absParent = path.resolve(parent) + path.sep;
  return absChild.startsWith(absParent) || absChild.slice(0, -1) === absParent.slice(0, -1);
}
