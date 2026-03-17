import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadWorkflow, parseWorkflowContent } from "../../../src/config/workflow-loader.js";

const fixturesDir = path.join(import.meta.dirname, "../../fixtures");

describe("loadWorkflow", () => {
  it("loads valid workflow with front matter", () => {
    const result = loadWorkflow(path.join(fixturesDir, "workflow-valid.md"));
    expect(result.config).toBeDefined();
    expect((result.config.tracker as Record<string, unknown>).kind).toBe("linear");
    expect(result.prompt_template).toContain("issue.identifier");
  });

  it("loads workflow without front matter", () => {
    const result = loadWorkflow(path.join(fixturesDir, "workflow-no-frontmatter.md"));
    expect(result.config).toEqual({});
    expect(result.prompt_template).toContain("issue.title");
  });

  it("throws missing_workflow_file for nonexistent file", () => {
    expect(() => loadWorkflow("/nonexistent/path.md")).toThrow("Cannot read workflow file");
  });

  it("throws workflow_front_matter_not_a_map for non-map YAML", () => {
    expect(() =>
      loadWorkflow(path.join(fixturesDir, "workflow-nonmap-yaml.md")),
    ).toThrow("must be a map");
  });
});

describe("parseWorkflowContent", () => {
  it("parses front matter and body", () => {
    const content = `---
key: value
---
Hello {{ issue.title }}`;
    const result = parseWorkflowContent(content);
    expect(result.config).toEqual({ key: "value" });
    expect(result.prompt_template).toBe("Hello {{ issue.title }}");
  });

  it("handles empty front matter", () => {
    const content = `---
---
Just a prompt.`;
    const result = parseWorkflowContent(content);
    expect(result.config).toEqual({});
    expect(result.prompt_template).toBe("Just a prompt.");
  });

  it("treats entire content as prompt when no front matter", () => {
    const result = parseWorkflowContent("No front matter here.");
    expect(result.config).toEqual({});
    expect(result.prompt_template).toBe("No front matter here.");
  });

  it("throws on unclosed front matter", () => {
    expect(() => parseWorkflowContent("---\nkey: value\n")).toThrow("never closed");
  });
});
