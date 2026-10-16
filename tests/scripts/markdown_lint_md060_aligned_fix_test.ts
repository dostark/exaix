/**
 * @module MarkdownLintMD060AlignedFixTest
 * @path tests/scripts/markdown_lint_md060_aligned_fix_test.ts
 * @description Regression tests for the MD060 auto-fix destroying `deno fmt` table padding.
 *   The fixer compacted every table in a file as soon as one table carried an MD060 finding, so a
 *   `deno fmt`-aligned table lost its alignment and `deno fmt --check` started to fail on a file it
 *   had just formatted. Table alignment belongs to `deno fmt`, so the fixer must rewrite only the
 *   tables it flagged and only when their own style is compact or tight.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert]
 * @related-files [scripts/markdown_lint.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";
import { applySpecificFixes, lintMarkdown } from "../../scripts/markdown_lint.ts";

const OPTS = { fix: true, strict: false, verbose: false };

function md060Findings(src: string) {
  return lintMarkdown(src, "t.md", OPTS).filter((f) => f.rule === "MD060/table-column-style");
}

function fixedOf(src: string): string {
  return applySpecificFixes(src, lintMarkdown(src, "t.md", OPTS)).fixed;
}

/** A `deno fmt`-padded table whose last cell outgrew its column, so its rows no longer align. */
const ALIGNED_TABLE = [
  "| Field | Note |",
  "| ----- | ---- |",
  "| a     | short |",
  "| bbbb  | a much longer note |",
  "",
].join("\n");

/** A `deno fmt`-padded table that carries no MD060 finding of its own. */
const CLEAN_ALIGNED_TABLE = [
  "| Field | Note  |",
  "| ----- | ----- |",
  "| a     | short |",
  "",
].join("\n");

/** A compact-style table that MD060 reports and that the fixer may normalize. */
const COMPACT_TABLE = [
  "|Field | Note|",
  "| --- | --- |",
  "| a | bb |",
  "",
].join("\n");

Deno.test("[md060-fix] an aligned table is never rewritten, so its deno fmt padding survives", () => {
  assert(md060Findings(ALIGNED_TABLE).length > 0, "the fixture must trigger MD060 or the fixer never runs");

  assertStringIncludes(fixedOf(`# Title\n\n${ALIGNED_TABLE}`), ALIGNED_TABLE);
});

Deno.test("[md060-fix] a file with one misaligned table keeps its other aligned tables untouched", () => {
  const src = `# Title\n\n${CLEAN_ALIGNED_TABLE}\n${ALIGNED_TABLE}`;
  assert(md060Findings(src).length > 0, "the fixture must trigger MD060");

  const fixed = fixedOf(src);

  assertStringIncludes(fixed, CLEAN_ALIGNED_TABLE);
  assertStringIncludes(fixed, ALIGNED_TABLE);
});

Deno.test("[md060-fix] a flagged compact table is still normalized", () => {
  assert(md060Findings(COMPACT_TABLE).length > 0, "the fixture must trigger MD060");

  const fixed = fixedOf(`# Title\n\n${COMPACT_TABLE}`);

  assertStringIncludes(fixed, "| Field | Note |");
  assertStringIncludes(fixed, "| a | bb |");
});
