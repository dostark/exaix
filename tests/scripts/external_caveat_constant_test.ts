/**
 * @module ExternalCaveatConstantTest
 * @path tests/scripts/external_caveat_constant_test.ts
 * @description Phase 144 Step 4 — single-source guard for the external-benchmark caveat text.
 *   The plan requires the caveat block rendered by `exactl eval report --view external` and the
 *   Phase 144 Step 6 docs to source their text from ONE constant so report and docs can never
 *   drift. This test asserts the source side: the constant is defined exactly once under
 *   packages/eval-history and is referenced by the CLI view that renders it. The docs-side
 *   reference is a Step 6 obligation (its own planned grep checks cover it).
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/external_benchmark.ts, packages/eval-history/mod.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import { assertEquals } from "@std/assert";

const CAVEAT_CONSTANT = "EXTERNAL_BENCHMARK_CAVEAT";
const PACKAGE_DIR = "packages/eval-history";
const CLI_VIEW_FILE = "apps/exactl/src/commands/eval_commands.ts";

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

Deno.test("[external-caveat] the caveat constant is defined exactly once under packages/eval-history", () => {
  const definitions: string[] = [];
  for (const dir of [`${Deno.cwd()}/${PACKAGE_DIR}`, `${Deno.cwd()}/${PACKAGE_DIR}/src`]) {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.isDirectory) continue;
      if (!entry.name.endsWith(".ts")) continue;
      const content = Deno.readTextFileSync(`${dir}/${entry.name}`);
      for (const line of content.split("\n")) {
        if (line.includes(`const ${CAVEAT_CONSTANT} =`) || line.includes(`const ${CAVEAT_CONSTANT}:`)) {
          definitions.push(`${dir}/${entry.name}`);
        }
      }
    }
  }
  assertEquals(definitions.length, 1, "caveat text must have exactly one definition site in the package");
  const source = Deno.readTextFileSync(definitions[0]);
  assertEquals(
    source.includes("derived, not native") && source.includes("contamination"),
    true,
    "caveat text must carry the derived-methodology label and contamination note",
  );
});

Deno.test("[external-caveat] the caveat constant is exported from the package mod", () => {
  const mod = Deno.readTextFileSync(`${Deno.cwd()}/${PACKAGE_DIR}/mod.ts`);
  assertEquals(
    mod.includes(`export { ${CAVEAT_CONSTANT} }`),
    true,
    "mod.ts must re-export the caveat constant for the CLI to import",
  );
});

Deno.test("[external-caveat] the external view references the constant and renders it", () => {
  const cli = Deno.readTextFileSync(`${Deno.cwd()}/${CLI_VIEW_FILE}`);
  const importLine =
    cli.split("\n").find((line) => line.startsWith("import {") && line.includes("@exaix/eval-history")) ?? "";
  assertEquals(
    importLine.includes(CAVEAT_CONSTANT),
    true,
    "eval_commands.ts must import the constant from @exaix/eval-history",
  );
  const usages = countOccurrences(cli, CAVEAT_CONSTANT);
  assertEquals(
    usages >= 2,
    true,
    "the constant must appear at the top and at least one render site",
  );
});

Deno.test("[external-caveat] the caveat text is never duplicated verbatim in the CLI", () => {
  const cli = Deno.readTextFileSync(`${Deno.cwd()}/${CLI_VIEW_FILE}`);
  const hardcoded = cli.split("\n").filter((line) =>
    line.includes("derived, not native") && !line.includes(CAVEAT_CONSTANT)
  );
  assertEquals(hardcoded, [], "the CLI must not restate the caveat text — only the constant");
});
