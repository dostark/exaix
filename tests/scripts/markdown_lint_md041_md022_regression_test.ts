/**
 * @module MarkdownLintMD041MD022RegressionTest
 * @path tests/scripts/markdown_lint_md041_md022_regression_test.ts
 * @description Regression tests for markdown lint rules MD041 and MD022.
 */

import { lintMarkdown, type ILintOptions } from "../../scripts/markdown_lint.ts";

const defaultOptions: ILintOptions = { fix: false, strict: false, verbose: false };

Deno.test("[regression] MD041 flags first non-blank line that is not H1", () => {
  const md = [
    "## Section Title",
    "",
    "Body",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md041 = findings.filter((f) => f.rule === "MD041/first-line-heading/first-line-h1");
  if (md041.length === 0) {
    throw new Error("expected at least one MD041 finding");
  }
});

Deno.test("[regression] MD041 is skipped when frontmatter has title", () => {
  const md = [
    "---",
    "title: Example",
    "---",
    "",
    "## Section Title",
    "",
    "Body",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md041 = findings.filter((f) => f.rule === "MD041/first-line-heading/first-line-h1");
  if (md041.length !== 0) {
    throw new Error(`expected 0 MD041 findings, got ${md041.length}`);
  }
});

Deno.test("[regression] MD022 flags missing blank around headings", () => {
  const md = [
    "Intro",
    "## Heading",
    "Body",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md022 = findings.filter((f) => f.rule === "MD022/blanks-around-headings");
  if (md022.length === 0) {
    throw new Error("expected at least one MD022 finding");
  }
});

Deno.test("[regression] MD022 allows heading with surrounding blank lines", () => {
  const md = [
    "Intro",
    "",
    "## Heading",
    "",
    "Body",
    "",
  ].join("\n");

  const findings = lintMarkdown(md, "inline.md", defaultOptions);
  const md022 = findings.filter((f) => f.rule === "MD022/blanks-around-headings");
  if (md022.length !== 0) {
    throw new Error(`expected 0 MD022 findings, got ${md022.length}`);
  }
});
