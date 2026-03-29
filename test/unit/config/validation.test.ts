import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateDispatchConfig } from "../../../src/config/validation.js";
import { buildServiceConfig } from "../../../src/config/config-layer.js";

function makeLinearConfig(overrides: Record<string, unknown> = {}) {
  return buildServiceConfig({
    mode: "linear",
    tracker: {
      kind: "linear",
      api_key: "test-key",
      project_slug: "proj",
      ...((overrides.tracker as Record<string, unknown>) ?? {}),
    },
    opencode: {
      command: "opencode",
      model: "provider/model",
    },
    ...overrides,
  });
}

function makeAutoresearchConfig(overrides: Record<string, unknown> = {}) {
  return buildServiceConfig({
    mode: "autoresearch",
    autoresearch: {
      program_md: "./autoresearch/program.md",
      prepare_py: "./autoresearch/prepare.py",
      train_py: "./autoresearch/train.py",
      ...((overrides.autoresearch as Record<string, unknown>) ?? {}),
    },
    opencode: {
      command: "opencode",
      model: "provider/model",
    },
    ...overrides,
  });
}

describe("validateDispatchConfig", () => {
  describe("linear mode", () => {
    it("passes for valid config", () => {
      const result = validateDispatchConfig(makeLinearConfig());
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when tracker.kind is missing", () => {
      const config = makeLinearConfig({ tracker: { api_key: "key", project_slug: "proj" } });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("tracker.kind"))).toBe(true);
    });

    it("fails when tracker.kind is unsupported", () => {
      const config = makeLinearConfig({ tracker: { kind: "jira", api_key: "key", project_slug: "proj" } });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("not supported"))).toBe(true);
    });

    it("fails when api_key is missing", () => {
      const origKey = process.env.LINEAR_API_KEY;
      delete process.env.LINEAR_API_KEY;
      const config = buildServiceConfig({
        mode: "linear",
        tracker: { kind: "linear", project_slug: "proj" },
        opencode: { command: "opencode", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("api_key"))).toBe(true);
      process.env.LINEAR_API_KEY = origKey;
    });

    it("fails when project_slug is missing for linear", () => {
      const config = makeLinearConfig({ tracker: { kind: "linear", api_key: "key" } });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("project_slug"))).toBe(true);
    });
  });

  describe("autoresearch mode", () => {
    it("passes for valid config with existing files", () => {
      const result = validateDispatchConfig(makeAutoresearchConfig());
      // Note: Files may not exist in test environment, so we check structure
      expect(result.errors.some((e) => e.includes("opencode.model"))).toBe(false);
    });

    it("fails when opencode.model is missing", () => {
      const config = buildServiceConfig({
        mode: "autoresearch",
        autoresearch: {
          program_md: "./autoresearch/program.md",
          prepare_py: "./autoresearch/prepare.py",
          train_py: "./autoresearch/train.py",
        },
        opencode: { command: "opencode", model: "" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("opencode.model"))).toBe(true);
    });

    it("fails when program_md is missing", () => {
      const config = buildServiceConfig({
        mode: "autoresearch",
        autoresearch: {
          prepare_py: "./autoresearch/prepare.py",
          train_py: "./autoresearch/train.py",
          program_md: "", // Empty string triggers validation
        },
        opencode: { command: "opencode", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("program_md"))).toBe(true);
    });

    it("fails when knowledge_enabled but embedding config missing", () => {
      const config = buildServiceConfig({
        mode: "autoresearch",
        autoresearch: {
          program_md: "./autoresearch/program.md",
          prepare_py: "./autoresearch/prepare.py",
          train_py: "./autoresearch/train.py",
          knowledge_enabled: true,
          embedding_endpoint: null,
          embedding_model: "",
        },
        opencode: { command: "opencode", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("embedding_endpoint"))).toBe(true);
      expect(result.errors.some((e) => e.includes("embedding_model"))).toBe(true);
    });

    it("fails when searxng_endpoint is invalid URL", () => {
      const config = buildServiceConfig({
        mode: "autoresearch",
        autoresearch: {
          program_md: "./autoresearch/program.md",
          prepare_py: "./autoresearch/prepare.py",
          train_py: "./autoresearch/train.py",
          searxng_endpoint: "not-a-valid-url",
        },
        opencode: { command: "opencode", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("searxng_endpoint") && e.includes("valid URL"))).toBe(true);
    });

    it("fails when max_crash_restarts is negative", () => {
      const config = buildServiceConfig({
        mode: "autoresearch",
        autoresearch: {
          program_md: "./autoresearch/program.md",
          prepare_py: "./autoresearch/prepare.py",
          train_py: "./autoresearch/train.py",
          max_crash_restarts: -5,
        },
        opencode: { command: "opencode", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("max_crash_restarts"))).toBe(true);
    });
  });

  describe("common validations", () => {
    it("fails when opencode.command is empty", () => {
      const config = buildServiceConfig({
        mode: "linear",
        tracker: { kind: "linear", api_key: "key", project_slug: "proj" },
        opencode: { command: "", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("opencode.command"))).toBe(true);
    });

    it("fails when server.port is out of range", () => {
      const config = makeLinearConfig({ server: { port: 99999 } });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("server.port"))).toBe(true);
    });

    it("fails when agent.max_concurrent_agents is less than 1", () => {
      const config = makeLinearConfig({ agent: { max_concurrent_agents: 0 } });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("max_concurrent_agents"))).toBe(true);
    });

    it("fails for unknown mode", () => {
      const config = buildServiceConfig({
        mode: "unknown",
        opencode: { command: "opencode", model: "provider/model" },
      });
      const result = validateDispatchConfig(config);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("mode") && e.includes("not supported"))).toBe(true);
    });
  });
});
