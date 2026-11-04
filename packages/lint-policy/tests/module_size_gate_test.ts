/**
 * @module ModuleSizeGateTest
 * @path packages/lint-policy/tests/module_size_gate_test.ts
 * @description Proves the module size gate: the Exaix catalog keeps the rule opt-in with the 800 and 1000 line limits, the task gates per-package ceilings, and a seeded oversized file in any root raises its package over the ceiling.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/helpers/ceiling_project.ts, packages/lint-policy/rule_ceilings.json]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { POLICY_CATALOG } from "../src/policy_config.ts";
import {
  CEILING_REPO_ROOT,
  gateOver,
  type ICeilingRule,
  runDeno,
  withCeilingProject,
} from "./helpers/ceiling_project.ts";

const KEY = "max-file-lines";
const RULE: ICeilingRule = { key: KEY, options: { max: 20, softMax: 10 } };
const SOFT_LIMIT = 800;
const HARD_LIMIT = 1000;

/** A file of the given number of lines. */
function fileOf(count: number): string {
  return Array.from({ length: count }, (_, index) => `export const v${index} = ${index};`).join("\n") + "\n";
}

Deno.test("module-size-policy: the Exaix catalog keeps the rule opt-in with a soft limit of 800 and a hard limit of 1000", () => {
  const entry = POLICY_CATALOG.rules["exaix/max-file-lines"];
  assertEquals(entry.severity, "off");
  assertEquals(entry.optIn, true);
  assertEquals(entry.options?.max, HARD_LIMIT);
  assertEquals(entry.options?.softMax, SOFT_LIMIT);
  assertEquals(entry.scope, "prod");
});

Deno.test("module-size-gate: an oversized file raises its package over the ceiling and the gate exits 1", async () => {
  await withCeilingProject(
    RULE,
    { "packages/x/src/big.ts": fileOf(25), "packages/x/src/ok.ts": fileOf(5) },
    async (dir) => {
      const over = await gateOver(dir, KEY, "packages");
      assertEquals(over.code, 1);
      assertEquals(over.over.map((row) => [row.packageName, row.count]), [["packages/x", 1]]);
      await Deno.writeTextFile(
        join(dir, "rule_ceilings.json"),
        JSON.stringify({ [`demo/${KEY}`]: { "packages/x": 1 } }),
      );
      assertEquals((await gateOver(dir, KEY, "packages")).code, 0);
    },
  );
});

Deno.test("module-size-gate: an oversized file in a Team package names its package", async () => {
  await withCeilingProject(RULE, { "exaix-team/packages/y/src/big.ts": fileOf(25) }, async (dir) => {
    const found = await gateOver(dir, KEY, "exaix-team");
    assertEquals(found.code, 1);
    assertEquals(found.over.map((row) => row.packageName), ["exaix-team/packages/y"]);
  });
});

Deno.test("module-size-gate: deno task check:module-size exits 0 on the branch", async () => {
  const result = await runDeno(["task", "check:module-size"], CEILING_REPO_ROOT);
  assertEquals(result.code, 0, result.stderr.slice(-2000));
});
