/**
 * @module UnwiredTypeExportsTest
 * @path packages/lint-policy/tests/unwired_type_exports_test.ts
 * @description Proves that the types added to name inline unions have no unwired export and that each interface keeps its own doc comment.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/git/src/git_queries.ts, scripts/check_runtime_artifacts.ts]
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const DESCRIPTOR = "packages/lint-policy/unslop.project.ts";
const WHOLE_TREE = "unslop-ts/src/cli/whole_tree.ts";
const REPORT_SUMMARY = /unwired export\(s\) in the trusted report|No unwired exports found/;
const DOC_BLOCK_END = /\*\/\s*$/;
const DOC_BLOCK = /\/\*\*[\s\S]*?\*\/\s*$/;

const NAMING_TYPES = [
  "TTruncationStrategy",
  "TMemoryNotificationType",
  "TOutputParserContextField",
  "TFeedbackStopReason",
  "IRoutingFrontmatter",
];

const DOCUMENTED_INTERFACES: ReadonlyArray<readonly [string, string]> = [
  ["packages/git/src/git_queries.ts", "interface IGitChangedSource {"],
  ["scripts/check_runtime_artifacts.ts", "interface IRuntimeArtifactViolation {"],
];

Deno.test("unused-export-warnings-cleared: the unwired export report names none of the five new types", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", WHOLE_TREE, `--descriptor=${DESCRIPTOR}`, "--rule=unused-exports"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const report = decoder.decode(result.stdout) + decoder.decode(result.stderr);
  assertEquals(result.code, 0, report);
  assert(REPORT_SUMMARY.test(report), "the report never ran, so a missing name proves nothing");
  for (const name of NAMING_TYPES) assertFalse(report.includes(`'${name}'`), `${name} is still an unwired export`);
});

Deno.test("each interface keeps its own doc comment and no two doc comments stack above one declaration", async () => {
  for (const [path, declaration] of DOCUMENTED_INTERFACES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    const index = source.indexOf(declaration);
    assert(index >= 0, `${path} no longer declares ${declaration}`);
    const before = source.slice(0, index);
    const block = DOC_BLOCK.exec(before);
    assert(block !== null, `${declaration} has no doc comment`);
    assertStringIncludes(block[0], "/**");
    const above = before.slice(0, block.index);
    assertFalse(DOC_BLOCK_END.test(above), `${declaration} sits below two stacked doc comments`);
  }
});
