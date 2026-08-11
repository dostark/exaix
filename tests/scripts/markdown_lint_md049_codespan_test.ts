/**
 * @module MarkdownLintMd049CodespanTest
 * @path tests/scripts/markdown_lint_md049_codespan_test.ts
 * @description Regression test for a destructive MD049 auto-fix bug (Phase 144 post-gap
 *   remediation writeup incident, 2026-08-10): MD049 is only ever DETECTED on a heading using
 *   underscore emphasis, but once triggered anywhere in the file the fixer's underscore-to-
 *   asterisk regex (`/_([^_]+)_/g`) ran across the ENTIRE document's raw line text — including
 *   backtick code spans and fenced code blocks on OTHER, non-heading lines. Any identifier
 *   containing underscores inside backticks (e.g. `` `CI_EXCLUDED_TAGS` ``) was misparsed as
 *   emphasis markup and corrupted into `` `CI*EXCLUDED*TAGS` `` — silently mangling code
 *   identifiers throughout the document, far from the single heading that triggered the fix.
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
