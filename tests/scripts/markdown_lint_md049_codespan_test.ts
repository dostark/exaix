/**
 * @module MarkdownLintMd049CodespanTest
 * @path tests/scripts/markdown_lint_md049_codespan_test.ts
 * @description Regression tests for destructive MD049 auto-fix bugs: MD049 is only ever
 *   DETECTED on a heading using underscore emphasis, but once triggered anywhere in the file
 *   the fixer's underscore-to-asterisk regex (`/_([^_]+)_/g`) runs across the ENTIRE document's
 *   raw line text — corrupting backtick code spans/fenced blocks (e.g. `` `CI_EXCLUDED_TAGS` ``
 *   into `` `CI*EXCLUDED*TAGS` ``) and bare (non-backticked) YAML frontmatter values (e.g.
 *   `short_summary: "...default_skills..."` into `short*summary: "...default*skills..."`,
 *   breaking YAML parsing) on OTHER, non-heading lines far from the fix's trigger.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert]
 * @related-files [scripts/markdown_lint.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { applySpecificFixes, lintMarkdown } from "../../scripts/markdown_lint.ts";

const OPTS = { fix: true, strict: false, verbose: false };

function md049Findings(src: string) {
  return lintMarkdown(src, "t.md", OPTS).filter((f) => f.rule === "MD049/emphasis-style");
}

Deno.test("[md049-fix] a heading's underscore emphasis triggers the fix, but a distant line's backtick-wrapped identifier is never touched (regression)", () => {
  const src = [
    "# A _stressed_ heading",
    "",
    "Container steps carry a `docker` tag added to `CI_EXCLUDED_TAGS`.",
    "",
  ].join("\n");

  const findings = md049Findings(src);
  assert(findings.length > 0, "expected an MD049 finding on the underscore-emphasis heading");

  const { fixed } = applySpecificFixes(src, findings);

  assertStringIncludes(fixed, "# A *stressed* heading", "the heading itself must still convert to asterisk emphasis");
  assertStringIncludes(
    fixed,
    "`CI_EXCLUDED_TAGS`",
    `code identifier on another line must survive intact; got:\n${fixed}`,
  );
  assert(!fixed.includes("CI*EXCLUDED*TAGS"), `identifier must not be corrupted into asterisks; got:\n${fixed}`);
});

Deno.test("[md049-fix] underscored identifiers inside a fenced code block are never rewritten, even when the fix is triggered elsewhere", () => {
  const src = [
    "# A _stressed_ heading",
    "",
    "```ts",
    "const MIN_SUPPORTED_COVERAGE_PCT = 30;",
    "```",
    "",
  ].join("\n");

  const { fixed } = applySpecificFixes(src, md049Findings(src));

  assertStringIncludes(fixed, "MIN_SUPPORTED_COVERAGE_PCT");
  assert(!fixed.includes("MIN*SUPPORTED*COVERAGE_PCT"), `fenced code must not be corrupted; got:\n${fixed}`);
});

Deno.test("[md049-fix] several underscored identifiers in separate code spans on one line all survive", () => {
  const src = [
    "# A _stressed_ heading",
    "",
    "See `readTaskLocalLicense` and `DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS` and `MAX_DRAINED_STREAM_BYTES`.",
    "",
  ].join("\n");

  const { fixed } = applySpecificFixes(src, md049Findings(src));

  assertStringIncludes(fixed, "`DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS`");
  assertStringIncludes(fixed, "`MAX_DRAINED_STREAM_BYTES`");
});

Deno.test("[md049-fix] genuine prose emphasis outside code spans still converts to asterisks", () => {
  const src = [
    "# A _stressed_ heading",
    "",
    "This has _real emphasis_ and `an_identifier_with_underscores` that must not change.",
    "",
  ].join("\n");

  const { fixed } = applySpecificFixes(src, md049Findings(src));

  assertStringIncludes(fixed, "*real emphasis*");
  assertStringIncludes(fixed, "`an_identifier_with_underscores`");
});

Deno.test("[md049-fix] a document with no underscore-emphasis heading is left untouched (no false trigger)", () => {
  const src = ["# A plain heading", "", "Some `CI_EXCLUDED_TAGS` prose.", ""].join("\n");
  const findings = md049Findings(src);
  assertEquals(findings.length, 0);
  const { fixed, changed } = applySpecificFixes(src, findings);
  assertEquals(changed, false);
  assertEquals(fixed, src);
});

Deno.test("[md049-fix] YAML frontmatter is never rewritten, even when a heading elsewhere triggers the fix (regression)", () => {
  // Reproduces the phase-161-identity-persona-value-isolation.md incident (2026-09-15):
  // a heading's underscore emphasis triggered the fixer, which then ran its whole-document
  // underscore-to-asterisk regex over the frontmatter block too. Bare (non-backticked)
  // underscores in a frontmatter string value — `short_summary: "...default_skills/
  // permitted_tools/model_size..."` — were misparsed as paired emphasis markers and
  // corrupted into `short*summary: "...default*skills/permitted*tools/model*size..."`,
  // breaking YAML parsing.
  const src = [
    "---",
    "status: PLANNING",
    'short_summary: "Holds default_skills/permitted_tools/model_size constant."',
    "---",
    "",
    "# A _stressed_ heading",
    "",
    "Body text.",
    "",
  ].join("\n");

  const { fixed } = applySpecificFixes(src, md049Findings(src));

  assertStringIncludes(fixed, "# A *stressed* heading", "the heading itself must still convert");
  assertStringIncludes(
    fixed,
    'short_summary: "Holds default_skills/permitted_tools/model_size constant."',
    `frontmatter must survive byte-for-byte; got:\n${fixed}`,
  );
  assert(!fixed.includes("short*summary"), `frontmatter key must not be corrupted; got:\n${fixed}`);
});
