/**
 * @module MarkdownLintMD060RegressionTest
 * @path tests/scripts/markdown_lint_md060_regression_test.ts
 * @description Regression tests for Markdown linting rule MD060, ensuring
 * stable validation of table alignment and checkmark formatting.
 */

import { lintMarkdown } from "../../scripts/markdown_lint.ts";

// Regression tests for MD060/table-column-style: the linter previously treated a broad
// Unicode range as double-width when computing table layout, causing false positives on
// valid tables containing symbols like "✓". Pipe positions are now compared by visual width.

type Options = { fix: boolean; strict: boolean; verbose: boolean };

const defaultOptions: Options = { fix: false, strict: false, verbose: false };

Deno.test("[regression] MD060 accepts aligned table with checkmarks", () => {
  const md = [
    "| Field      | Required | Example |",
    "| ---------- | -------- | ------- |",
    "| trace_id   | ✓        | `abc`   |",
    "| created_by |          | `x@y`   |",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md060 = findings.filter((f) => f.rule === "MD060/table-column-style");
  if (md060.length !== 0) {
    throw new Error(`expected 0 MD060 findings, got ${md060.length}`);
  }
});

Deno.test("[regression] MD060 reports misaligned aligned-style table", () => {
  const md = [
    "| Field      | Required | Example |",
    "| ---------- | -------- | ------- |",
    "| trace_id   | ✓       | `abc`   |", // one fewer space: misalign the pipe
    "| created_by |         | `x@y`   |",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md060 = findings.filter((f) => f.rule === "MD060/table-column-style");
  if (md060.length === 0) {
    throw new Error("expected at least one MD060 finding");
  }
});
