import { describe, it, expect } from "vitest";
import { validateDispatchConfig } from "../../../src/config/validation.js";
import { buildServiceConfig } from "../../../src/config/config-layer.js";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return buildServiceConfig({
    tracker: {
      kind: "linear",
      api_key: "test-key",
      project_slug: "proj",
      ...((overrides.tracker as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

describe("validateDispatchConfig", () => {
  it("passes for valid config", () => {
    const result = validateDispatchConfig(makeConfig());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when tracker.kind is missing", () => {
    const config = makeConfig({ tracker: { api_key: "key", project_slug: "proj" } });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("tracker.kind"))).toBe(true);
  });

  it("fails when tracker.kind is unsupported", () => {
    const config = makeConfig({ tracker: { kind: "jira", api_key: "key", project_slug: "proj" } });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("not supported"))).toBe(true);
  });

  it("fails when api_key is missing", () => {
    const config = makeConfig({ tracker: { kind: "linear", project_slug: "proj" } });
    // Clear env var too
    const origKey = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    const config2 = buildServiceConfig({
      tracker: { kind: "linear", project_slug: "proj" },
    });
    const result = validateDispatchConfig(config2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("api_key"))).toBe(true);
    process.env.LINEAR_API_KEY = origKey;
  });

  it("fails when project_slug is missing for linear", () => {
    const config = makeConfig({ tracker: { kind: "linear", api_key: "key" } });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("project_slug"))).toBe(true);
  });
});
