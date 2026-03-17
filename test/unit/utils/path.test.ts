import { describe, it, expect } from "vitest";
import { expandPath, isContainedIn } from "../../../src/utils/path.js";
import os from "node:os";
import path from "node:path";

describe("expandPath", () => {
  it("expands ~ to home directory", () => {
    const result = expandPath("~/projects");
    expect(result).toBe(path.join(os.homedir(), "projects"));
  });

  it("resolves paths with separators to absolute", () => {
    const result = expandPath("/tmp/workspaces");
    expect(result).toBe("/tmp/workspaces");
  });

  it("preserves bare strings without path separators", () => {
    expect(expandPath("relative_name")).toBe("relative_name");
  });
});

describe("isContainedIn", () => {
  it("returns true for child paths", () => {
    expect(isContainedIn("/tmp/root/child", "/tmp/root")).toBe(true);
    expect(isContainedIn("/tmp/root/a/b/c", "/tmp/root")).toBe(true);
  });

  it("returns false for paths outside root", () => {
    expect(isContainedIn("/tmp/other", "/tmp/root")).toBe(false);
    expect(isContainedIn("/tmp/root/../other", "/tmp/root")).toBe(false);
  });

  it("returns true for same path", () => {
    expect(isContainedIn("/tmp/root", "/tmp/root")).toBe(true);
  });
});
