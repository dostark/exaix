/**
 * @module MarkdownLintMD025RegressionTest
 * @path tests/scripts/markdown_lint_md025_regression_test.ts
 * @description Regression tests for Markdown linting rule MD025.
 */

import { lintMarkdown, type ILintOptions } from "../../scripts/markdown_lint.ts";

const defaultOptions: ILintOptions = { fix: false, strict: false, verbose: false };

Deno.test("[regression] MD025 flags H1 when frontmatter has title", () => {
  const md = [
    "---",
    "title: Example Doc",
    "---",
    "",
    "# Example Doc",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md025 = findings.filter((f) => f.rule === "MD025/single-title/single-h1");
  if (md025.length === 0) {
    throw new Error("expected at least one MD025 finding");
  }
});

Deno.test("[regression] MD025 allows single H1 without frontmatter title", () => {
  const md = [
    "# One Title",
    "",
    "Some text.",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md025 = findings.filter((f) => f.rule === "MD025/single-title/single-h1");
  if (md025.length !== 0) {
    throw new Error(`expected 0 MD025 findings, got ${md025.length}`);
  }
});

Deno.test("[regression] MD025 flags second H1 without frontmatter title", () => {
  const md = [
    "# First",
    "",
    "Some text.",
    "",
    "# Second",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md025 = findings.filter((f) => f.rule === "MD025/single-title/single-h1");
  if (md025.length === 0) {
    throw new Error("expected at least one MD025 finding");
  }
});
