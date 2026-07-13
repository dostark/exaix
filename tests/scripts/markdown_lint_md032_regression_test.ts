/**
 * @module MarkdownLintMD032RegressionTest
 * @path tests/scripts/markdown_lint_md032_regression_test.ts
 * @description Regression tests for Markdown linting rule MD032, ensuring
 * correct enforcement of blank lines around list blocks.
 */

import { type ILintOptions, lintMarkdown } from "../../scripts/markdown_lint.ts";

/**
 * Regression tests for MD032/blanks-around-lists.
 *
 * Bug: The custom linter incorrectly flagged multi-line ordered lists by
 * requiring a blank line before EACH list item (because continuation lines of
 * the previous list item are not list markers).
 *
 * Fix: Treat list-item continuation lines as part of the list context.
 */

const defaultOptions: ILintOptions = { fix: false, strict: false, verbose: false };

Deno.test("[regression] MD032 does not require blank lines between list items", () => {
  const md = [
    "Intro paragraph.",
    "",
    "1. First item has a wrapped line",
    "   that continues here.",
    "2. Second item has a wrapped line",
    "   that continues here.",
    "",
    "Outro paragraph.",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md032 = findings.filter((f) => f.rule === "MD032/blanks-around-lists");
  if (md032.length !== 0) {
    throw new Error(`expected 0 MD032 findings, got ${md032.length}`);
  }
});

Deno.test("[regression] MD032 flags list not preceded by blank line", () => {
  const md = [
    "Intro paragraph.",
    "1. List starts immediately (should fail)",
    "2. Second item",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md032 = findings.filter((f) => f.rule === "MD032/blanks-around-lists");
  if (md032.length === 0) {
    throw new Error("expected at least one MD032 finding");
  }
});
