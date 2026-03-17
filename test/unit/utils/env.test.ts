import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEnvVar } from "../../../src/utils/env.js";

describe("resolveEnvVar", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_VAR = "test_value";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves $VAR to env value", () => {
    expect(resolveEnvVar("$TEST_VAR")).toBe("test_value");
  });

  it("returns empty string for missing env var", () => {
    expect(resolveEnvVar("$NONEXISTENT_VAR")).toBe("");
  });

  it("returns value as-is if not starting with $", () => {
    expect(resolveEnvVar("literal_value")).toBe("literal_value");
    expect(resolveEnvVar("")).toBe("");
  });
});
