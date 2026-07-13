/**
 * @module MarkdownLintMD012MD031Test
 * @path tests/scripts/markdown_lint_md012_md031_test.ts
 * @description Tests for MD012 (no-multiple-blanks) and MD031
 * (blanks-around-fences) detection and auto-fix.
 */

import { assertEquals } from "@std/assert";
import { type ILintOptions, lintMarkdown } from "../../scripts/markdown_lint.ts";

const defaultOptions: ILintOptions = { fix: false, strict: false, verbose: false };

// ---------------------------------------------------------------------------
// MD012 — no multiple consecutive blank lines
// ---------------------------------------------------------------------------

Deno.test("[MD012] flags multiple consecutive blank lines", () => {
  const md = ["# Title", "", "", "", "Paragraph.", ""].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md012 = findings.filter((f) => f.rule === "MD012/no-multiple-blanks");
  assertEquals(md012.length > 0, true, "should flag multiple blanks");
});

Deno.test("[MD012] allows single blank line between content", () => {
  const md = ["# Title", "", "Paragraph.", ""].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md012 = findings.filter((f) => f.rule === "MD012/no-multiple-blanks");
  assertEquals(md012.length, 0, "single blank should not trigger MD012");
});

Deno.test("[MD012] does NOT flag multiple blanks inside fenced code", () => {
  const md = [
    "# Title",
    "",
    "```text",
    "line 1",
    "",
    "",
    "",
    "line 2",
    "```",
    "",
  ].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md012 = findings.filter((f) => f.rule === "MD012/no-multiple-blanks");
  assertEquals(md012.length, 0, "blanks inside fence should be ignored by MD012");
});

Deno.test("[MD012] flags blanks outside fence but not inside", () => {
  const md = [
    "# Title",
    "",
    "",
    "```text",
    "",
    "",
    "```",
    "",
  ].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md012 = findings.filter((f) => f.rule === "MD012/no-multiple-blanks");
  // Should only flag the blanks between Title and the fence (outside)
  assertEquals(md012.length > 0, true, "should flag blanks outside fence");
  // All findings should be BEFORE the fence opens (line 3 at most)
  for (const f of md012) {
    assertEquals(f.line < 4, true, `MD012 at line ${f.line} should be before fence`);
  }
});

// ---------------------------------------------------------------------------
// MD031 — fenced code blocks should be surrounded by blank lines
// ---------------------------------------------------------------------------

Deno.test("[MD031] flags fence not preceded by blank line", () => {
  const md = [
    "# Title",
    "",
    "Some text.",
    "```text",
    "code",
    "```",
    "",
  ].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md031 = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  assertEquals(md031.length > 0, true, "should flag missing blank before fence");
});

Deno.test("[MD031] flags fence not followed by blank line", () => {
  const md = [
    "# Title",
    "",
    "```text",
    "code",
    "```",
    "Some text.",
    "",
  ].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md031 = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  assertEquals(md031.length > 0, true, "should flag missing blank after fence");
});

Deno.test("[MD031] allows properly surrounded fence", () => {
  const md = [
    "# Title",
    "",
    "Some text.",
    "",
    "```text",
    "code",
    "```",
    "",
    "More text.",
    "",
  ].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md031 = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  assertEquals(md031.length, 0, "properly surrounded fence should not trigger MD031");
});

Deno.test("[MD031] flags both missing blanks (before and after)", () => {
  const md = [
    "# Title",
    "",
    "Before.",
    "```text",
    "code",
    "```",
    "After.",
    "",
  ].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md031 = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  assertEquals(md031.length, 2, "should flag both before and after");
});

Deno.test("[MD031] allows fence at start of file", () => {
  const md = ["```text", "code", "```", "", "Some text.", ""].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md031 = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  assertEquals(md031.length, 0, "fence at start of file should not flag 'before'");
});

Deno.test("[MD031] allows fence at end of file", () => {
  const md = ["# Title", "", "```text", "code", "```", ""].join("\n");
  const findings = lintMarkdown(md, "test.md", defaultOptions);
  const md031 = findings.filter((f) => f.rule === "MD031/blanks-around-fences");
  assertEquals(md031.length, 0, "fence at end of file should not flag 'after'");
});
