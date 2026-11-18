/**
 * @module ImportCyclesDocsTest
 * @path tests/docs/import_cycles_docs_test.ts
 * @description The Exaix code style names the cycle task, its gate and the committed baseline policy.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [packages/lint-policy/src/script_rules.ts, packages/lint-policy/unslop.project.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";

const CODE_STYLE = await Deno.readTextFile(new URL("../../docs/CODE_STYLE.md", import.meta.url));

Deno.test("docs-code-style: CODE_STYLE names the advisory task, the gate and the baseline policy", () => {
  assertStringIncludes(CODE_STYLE, "deno task check:cycles");
  assertStringIncludes(CODE_STYLE, "deno task check:cycles:gate");
  assertStringIncludes(CODE_STYLE, "packages/lint-policy/cycle_baseline.json");
  assertStringIncludes(CODE_STYLE, "allowed_unresolved");
  assertStringIncludes(CODE_STYLE, "advisory");
  assertStringIncludes(CODE_STYLE, "--update-baseline");
  assert(!CODE_STYLE.includes("count-only cycle"), "no stale count-only claim remains");
});
