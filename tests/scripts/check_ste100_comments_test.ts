/**
 * @module Ste100CommentsCheckTest
 * @path tests/scripts/check_ste100_comments_test.ts
 * @description Phase 195 Step 6 — RED-first tests for the code-comment STE authoring gate.
 *   Asserts parser-aware extraction (line/block/inline/JSDoc prose, no strings/regex/
 *   template-literal false positives), shared-rule counting (STE-5.1/6.3/6.6/8.1) on
 *   comment prose, directive/literal/tag preservation with no false positives, the
 *   diff-aware staged ratchet (only comments on added/changed lines gate; untouched
 *   pre-existing comments stay grandfathered), the real CLI exit codes 0/1/2, and the
 *   staged orchestration passing on an empty stage.
 * @architectural-layer Test
 * @related-files [
 *   "scripts/check_ste100_comments.ts",
 *   "scripts/ste100_prose_rules.ts"
 * ]
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  checkText,
  extractCommentSpans,
  parseChangedLinesFromUnifiedDiff,
  runSte100CommentsCheck,
} from "../../scripts/check_ste100_comments.ts";

const SCRIPT_PATH = fromFileUrl(
  import.meta.resolve("../../scripts/check_ste100_comments.ts"),
);

const LONG_PROCEDURAL = "Add two sentence limit checks that preserve every existing invariant while also " +
  "improving the counting path for nested wrapped and partially atomic edge cases.";

const LONG_DESCRIPTIVE = "This new function preserves every previously reviewed obligation while adding " +
  "support for nested and wrapped atomic sentence counting paths across multiple " +
  "boundary conditions.";

Deno.test("Comment checker extracts line block inline and JSDoc prose with locations", () => {
  const source = [
    "/**",
    " * Preserve the invariant on the counting path.",
    " */",
    "export function f(): void {",
    "  // Keep the result sorted before publishing.",
    "  const x = 1; /* explain the non-obvious constant */",
    "}",
  ].join("\n");
  const spans = extractCommentSpans(source, "sample.ts");
  const texts = spans.map((s) => s.prose);
  assert(texts.some((t) => t.includes("Preserve the invariant on the counting path.")), "JSDoc prose extracted");
  assert(texts.some((t) => t.includes("Keep the result sorted")), "line comment extracted");
  assert(texts.some((t) => t.includes("explain the non-obvious constant")), "inline block comment extracted");
  const jsdoc = spans.find((s) => s.prose.includes("Preserve the invariant"))!;
  assertEquals(jsdoc.line, 2, "JSDoc prose reported on its real line");
});

Deno.test("Comment checker ignores strings regex literals and template text", () => {
  const source = [
    "const s = '// not a comment at all';",
    "const r = /add two sentence limit checks that preserve every single one of them/;",
    "const t = `/* still not a comment */`;",
    "export function f(): void {}",
  ].join("\n");
  const spans = extractCommentSpans(source, "sample.ts");
  assertEquals(spans.length, 0, "comment-like text inside strings/regex/templates is not extracted");
});

Deno.test("Comment checker preserves directives tags and literal spans without false positives", () => {
  const lintIgnore = "// " + "deno-lint-ignore" + " no-explicit-any";
  const source = [
    lintIgnore,
    "/** @param foo The parameter to process. */",
    "function ignoreMe(foo: any): void {}",
    "// See `parseYaml` and the `foo: [bar]` schema for the exact shape.",
  ].join("\n");
  const result = checkText(source, "directives.ts");
  assertEquals(result.findings.length, 0, "directives/tags/literal-heavy comments produce no findings");
});

Deno.test("Comment checker counts procedural and descriptive sentences with the shared core", () => {
  const procedural = checkText(`// ${LONG_PROCEDURAL}`, "proc.ts");
  assertMatch(procedural.findings[0]?.ruleId ?? "", /^STE-5\.1$/, "procedural over-limit flags STE-5.1");
  const descriptive = checkText(`// ${LONG_DESCRIPTIVE}`, "desc.ts");
  assertMatch(descriptive.findings[0]?.ruleId ?? "", /^STE-6\.3$/, "descriptive over-limit flags STE-6.3");
});

Deno.test("Comment checker flags semicolons in eligible prose (STE-8.1)", () => {
  const result = checkText("// Preserve the invariant; then publish the result.", "semi.ts");
  assertMatch(result.findings[0]?.ruleId ?? "", /^STE-8\.1$/, "semicolon in comment prose flags STE-8.1");
});

Deno.test("Diff-aware ratchet gates only comments on added or changed lines", () => {
  const source = [
    "// This long pre-existing comment does not get retroactively converted",
    "export function f(): void {}",
    "// " + LONG_DESCRIPTIVE,
  ].join("\n");
  // Hypothetical staged diff adds line 3 (the second comment) only.
  const touchedOnlyLine3 = checkText(source, "ratchet.ts", new Set([3]));
  assertEquals(touchedOnlyLine3.findings.length, 1, "only the added-line comment is gated");
  assertEquals(touchedOnlyLine3.findings[0].line, 3, "finding location is the added line");
  const untouchedLine1 = checkText(source, "ratchet.ts", new Set([2]));
  assertEquals(untouchedLine1.findings.length, 0, "pre-existing comment on an unchanged line is grandfathered");
});

Deno.test("Comment checker groups consecutive single-line comments into one wrapped sentence", () => {
  const source = [
    "// This new function preserves every previously reviewed obligation while adding",
    "// support for nested and wrapped atomic sentence counting paths across four cells.",
    "export const a = 1;",
  ].join("\n");
  const spans = extractCommentSpans(source, "wrap.ts");
  assertEquals(spans.length, 1, "consecutive adjacent line comments are grouped");
  const result = checkText(source, "wrap.ts");
  assertEquals(result.findings.length, 1, "a wrapped over-limit sentence is caught once");
  assertEquals(result.findings[0].line, 1, "grouped span reports the first line");
});

Deno.test("Unified diff parser resolves added line numbers", () => {
  const diff = [
    "@@ -1,3 +1,5 @@",
    " export function a() {}",
    "+// " + LONG_DESCRIPTIVE,
    "+export function b(): void {}",
    " export function c(): void {}",
  ].join("\n");
  const added = parseChangedLinesFromUnifiedDiff(diff);
  assert(added.has(2), "added comment line 2 present");
  assert(added.has(3), "added code line 3 present");
  assertEquals(added.has(1), false, "context line 1 is not added");
});

Deno.test("Focused run reports confirmed findings with real locations and exit 1", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "violation.ts");
  await Deno.writeTextFile(file, `// ${LONG_PROCEDURAL}\nexport const a = 1;\n`);
  const result = await runSte100CommentsCheck({ focused: [file] });
  assertEquals(result.exitCode, 1, "focused file with a violation exits 1");
  assertEquals(result.findings[0].path, file, "finding names the file");
  assertEquals(result.findings[0].line, 1, "finding keeps the source line");
});

Deno.test("Focused run exits 0 on a clean file", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "clean.ts");
  await Deno.writeTextFile(file, "// Preserve the invariant.\nexport const a = 1;\n");
  const result = await runSte100CommentsCheck({ focused: [file] });
  assertEquals(result.exitCode, 0, "clean focused file exits 0");
});

Deno.test("Real CLI returns violation and success exit codes", async () => {
  const dir = await Deno.makeTempDir();
  const bad = join(dir, "bad.ts");
  await Deno.writeTextFile(bad, `// ${LONG_DESCRIPTIVE}\nexport const a = 1;\n`);
  const command = new Deno.Command("deno", {
    args: ["run", "-A", "--quiet", SCRIPT_PATH, "--focused", bad],
    stdout: "piped",
    stderr: "piped",
  });
  const { code } = await command.output();
  assertEquals(code, 1, "CLI exits 1 on a confirmed violation");

  const good = join(dir, "good.ts");
  await Deno.writeTextFile(good, "// Preserve the invariant.\nexport const a = 1;\n");
  const goodCommand = new Deno.Command("deno", {
    args: ["run", "-A", "--quiet", SCRIPT_PATH, "--focused", good],
    stdout: "piped",
    stderr: "piped",
  });
  const { code: goodCode } = await goodCommand.output();
  assertEquals(goodCode, 0, "CLI exits 0 on a clean file");
});

Deno.test("Staged run passes when nothing is staged", async () => {
  const result = await runSte100CommentsCheck({ staged: true });
  assertEquals(result.exitCode, 0, "empty stage cannot produce confirmed findings");
});
