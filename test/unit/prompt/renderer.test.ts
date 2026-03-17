import { describe, it, expect } from "vitest";
import { renderPrompt, buildTurnPrompt } from "../../../src/prompt/renderer.js";
import type { Issue } from "../../../src/types/issue.js";

const testIssue: Issue = {
  id: "abc123",
  identifier: "MT-42",
  title: "Fix the bug",
  description: "There is a bug in the login flow",
  priority: 1,
  state: "Todo",
  branch_name: "mt-42-fix-bug",
  url: "https://linear.app/team/issue/MT-42",
  labels: ["bug", "urgent"],
  blocked_by: [],
  created_at: new Date("2025-01-01T00:00:00Z"),
  updated_at: new Date("2025-01-02T00:00:00Z"),
};

describe("renderPrompt", () => {
  it("renders issue fields", async () => {
    const template = "Work on {{ issue.identifier }}: {{ issue.title }}";
    const result = await renderPrompt(template, testIssue, null);
    expect(result).toBe("Work on MT-42: Fix the bug");
  });

  it("renders attempt variable", async () => {
    const template = "{% if attempt %}Retry {{ attempt }}{% else %}First run{% endif %}";
    expect(await renderPrompt(template, testIssue, null)).toBe("First run");
    expect(await renderPrompt(template, testIssue, 2)).toBe("Retry 2");
  });

  it("renders labels with loop", async () => {
    const template = "{% for label in issue.labels %}{{ label }} {% endfor %}";
    const result = await renderPrompt(template, testIssue, null);
    expect(result.trim()).toContain("bug");
    expect(result.trim()).toContain("urgent");
  });

  it("fails on unknown variables in strict mode", async () => {
    const template = "{{ unknown_var }}";
    await expect(renderPrompt(template, testIssue, null)).rejects.toThrow();
  });
});

describe("buildTurnPrompt", () => {
  it("returns rendered template for first turn", async () => {
    const template = "Work on {{ issue.title }}";
    const result = await buildTurnPrompt(template, testIssue, null, 1);
    expect(result).toBe("Work on Fix the bug");
  });

  it("returns continuation guidance for subsequent turns", async () => {
    const result = await buildTurnPrompt("any template", testIssue, null, 2);
    expect(result).toContain("Continue working on MT-42");
    expect(result).toContain("Fix the bug");
  });

  it("returns fallback prompt for empty template", async () => {
    const result = await buildTurnPrompt("", testIssue, null, 1);
    expect(result).toContain("working on an issue");
  });
});
