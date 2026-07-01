/**
 * @module MarkdownLintMd029FixTest
 * @path tests/scripts/markdown_lint_md029_fix_test.ts
 * @description Regression test for the destructive MD029 auto-fix bug: when an
 *   ordered list is renumbered from `1./2./3.` to the `1./1./1.` style, the fixer
 *   must PRESERVE each item's content. The original bug pushed only the rewritten
 *   marker (`indent + "1" + <matched-prefix>`), discarding everything after the
 *   list marker and — after trimEnd() — leaving bare `1.` markers, corrupting many
 *   documents (e.g. numbered checklists losing every item body after the first).
 * @architectural-layer Script (test)
 * @dependencies [@std/assert]
 * @related-files [scripts/markdown_lint.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { applySpecificFixes, lintMarkdown } from "../../scripts/markdown_lint.ts";

const OPTS = { fix: true, strict: false, verbose: false };

/** Build the MD029 findings for a given source, as the fixer expects them. */
function md029Findings(src: string) {
  return lintMarkdown(src, "t.md", OPTS).filter((f) => f.rule === "MD029/ol-prefix");
}

Deno.test("[md029-fix] renumbering to 1/1/1 preserves each item's content (regression)", () => {
  const src = [
    "1. First item body",
    "2. Second item body",
    "3. Third item body",
    "",
  ].join("\n");

  const findings = md029Findings(src);
  assert(findings.length > 0, "expected MD029 findings on a 1/2/3 list");

  const { fixed } = applySpecificFixes(src, findings);

  // Every item must survive with its body intact — no bare "1." markers.
  assertStringIncludes(fixed, "1. First item body");
  assertStringIncludes(fixed, "1. Second item body");
  assertStringIncludes(fixed, "1. Third item body");
  assert(
    !/^\s*1\.\s*$/m.test(fixed),
    `no bare "1." marker should remain; got:\n${fixed}`,
  );
});

Deno.test("[md029-fix] preserves indented / nested ordered-list item bodies", () => {
  const src = [
    "1. Top item",
    "   1. nested a",
    "   2. nested b",
    "",
  ].join("\n");

  const { fixed } = applySpecificFixes(src, md029Findings(src));

  assertStringIncludes(fixed, "nested a");
  assertStringIncludes(fixed, "nested b");
  assert(!/^\s*1\.\s*$/m.test(fixed), "no bare marker in nested list");
});

Deno.test("[md029-fix] a 1/1/1 list is left unchanged (idempotent, no false rewrite)", () => {
  const src = ["1. a", "1. b", "1. c", ""].join("\n");
  const findings = md029Findings(src);
  // Already-correct style → no MD029 findings → no destructive rewrite.
  assertEquals(findings.length, 0);
  const { fixed, changed } = applySpecificFixes(src, findings);
  assertEquals(changed, false);
  assertEquals(fixed, src);
});
