import { describe, it, expect } from "vitest";
import { sanitizeWorkspaceKey } from "../../../src/utils/sanitize.js";

describe("sanitizeWorkspaceKey", () => {
  it("preserves valid characters", () => {
    expect(sanitizeWorkspaceKey("ABC-123")).toBe("ABC-123");
    expect(sanitizeWorkspaceKey("project.v2")).toBe("project.v2");
    expect(sanitizeWorkspaceKey("test_name")).toBe("test_name");
  });

  it("replaces invalid characters with underscore", () => {
    expect(sanitizeWorkspaceKey("ABC 123")).toBe("ABC_123");
    expect(sanitizeWorkspaceKey("foo/bar")).toBe("foo_bar");
    expect(sanitizeWorkspaceKey("hello@world")).toBe("hello_world");
    expect(sanitizeWorkspaceKey("a:b:c")).toBe("a_b_c");
  });

  it("handles empty string", () => {
    expect(sanitizeWorkspaceKey("")).toBe("");
  });
});
