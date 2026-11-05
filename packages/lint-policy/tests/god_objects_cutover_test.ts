/**
 * @module GodObjectsCutoverTest
 * @path packages/lint-policy/tests/god_objects_cutover_test.ts
 * @description Proves the god-class cutover: the Exaix catalog uses the God Class strategy, the task gates per-package ceilings over every linted root including Team, and the compare task lists the classes that only one strategy flags.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/tests/complexity_cutover_test.ts, scripts/god_objects_compare.ts, packages/lint-policy/rule_ceilings.json]
 */

import { assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { POLICY_CATALOG } from "../src/policy_config.ts";
import { GOD, godClassSource } from "../../../unslop-ts/tests/helpers/god_class_fixture.ts";
import {
  CEILING_REPO_ROOT as REPO_ROOT,
  gateOver,
  type ICeilingRule,
  type IProcessRun,
  runDeno,
  withCeilingProject,
} from "./helpers/ceiling_project.ts";

const COMPARE = join(REPO_ROOT, "scripts/god_objects_compare.ts");
const RULE = "demo/max-class-size";
const KEY = "max-class-size";
const GOD_CLASS = "god-class";
/** The legacy score flags every class under these options, and the God Class strategy ignores them. */
const GOD_RULE: ICeilingRule = { key: KEY, options: { strategy: GOD_CLASS, minClassLines: 1, threshold: 1 } };
const SMALL_CLASS =
  "export class Small {\n  one(): number {\n    return 1;\n  }\n  two(): number {\n    return 2;\n  }\n}\n";

async function compareOver(dir: string, extra: readonly string[] = []): Promise<IProcessRun> {
  return await runDeno([
    "run",
    "-A",
    COMPARE,
    `--rule=${RULE}`,
    "--roots=packages",
    "--descriptor=unslop.project.ts",
    "--ceilings=rule_ceilings.json",
    ...extra,
  ], dir);
}

function hub(name: string): string {
  return `import type { Other } from "./other.ts";\n${
    godClassSource(GOD).replace("class Hub", `export class ${name}`)
  }`;
}

Deno.test("god-objects-cutover: the Exaix catalog selects the God Class strategy", () => {
  assertEquals(POLICY_CATALOG.rules["exaix/max-class-size"].options?.strategy, GOD_CLASS);
});

Deno.test("god-objects-cutover: a seeded god class raises its package over the ceiling and the gate exits 1", async () => {
  await withCeilingProject(GOD_RULE, { "packages/x/src/hub.ts": hub("Hub") }, async (dir) => {
    const over = await gateOver(dir, KEY, "packages");
    assertEquals(over.code, 1);
    assertEquals(over.over.map((row) => [row.packageName, row.count]), [["packages/x", 1]]);
    await Deno.writeTextFile(join(dir, "rule_ceilings.json"), JSON.stringify({ [RULE]: { "packages/x": 1 } }));
    assertEquals((await gateOver(dir, KEY, "packages")).code, 0);
  });
});

Deno.test("god-objects-cutover: deno task check:god-objects exits 0 on the branch", async () => {
  const result = await runDeno(["task", "check:god-objects"], REPO_ROOT);
  assertEquals(result.code, 0, result.stderr.slice(-2000));
});

Deno.test("god-objects-team-root: a god class in a Team package and one in a tests directory each fail and name their package", async () => {
  const files = {
    "exaix-team/packages/y/src/hub.ts": hub("TeamHub"),
    "tests/hub.ts": hub("TestHub"),
    "packages/x/src/small.ts": SMALL_CLASS,
  };
  await withCeilingProject(GOD_RULE, files, async (dir) => {
    const found = await gateOver(dir, KEY, "packages,tests,exaix-team");
    assertEquals(found.code, 1);
    assertEquals(found.over.map((row) => row.packageName).sort(), [".", "exaix-team/packages/y"]);
  });
});

Deno.test("god-objects-compare: the compare task lists the classes that only one strategy flags and leaves the config untouched", async () => {
  await withCeilingProject(
    GOD_RULE,
    { "packages/x/src/hub.ts": hub("Hub"), "packages/x/src/small.ts": SMALL_CLASS },
    async (dir) => {
      const before = await Deno.readTextFile(join(dir, "unslop.config.json"));
      const result = await compareOver(dir);
      assertEquals(result.code, 0, result.stderr);
      assertStringIncludes(result.stdout, "Only legacy-score");
      const [, onlyLegacy] = result.stdout.split("Only legacy-score");
      assertStringIncludes(onlyLegacy, "Small");
      assertNotMatch(onlyLegacy, /Hub/);
      const [bothSection] = result.stdout.split("Only god-class");
      assertStringIncludes(bothSection, "Hub");
      assertEquals(await Deno.readTextFile(join(dir, "unslop.config.json")), before);
    },
  );
});

Deno.test("god-objects-compare-custom-config [security]: reject mismatches before writes and measure a matching custom policy", async () => {
  await withCeilingProject(GOD_RULE, { "packages/x/src/small.ts": SMALL_CLASS }, async (dir) => {
    const policyPath = join(dir, "unslop.config.json");
    const customPath = join(dir, "custom.json");
    const before = await Deno.readTextFile(policyPath);
    await Deno.writeTextFile(customPath, before);
    const mismatch = await compareOver(dir, ["--config=custom.json"]);
    assertEquals(mismatch.code === 0, false, mismatch.stdout);
    assertStringIncludes(mismatch.stderr, "--config must match");
    assertEquals(await Deno.readTextFile(policyPath), before);
    assertEquals(await Deno.readTextFile(customPath), before);
    for (const name of ["unslop.project.ts", "plugin.ts"]) {
      const path = join(dir, name);
      await Deno.writeTextFile(path, (await Deno.readTextFile(path)).replaceAll("unslop.config.json", "custom.json"));
    }
    const matching = await compareOver(dir, ["--config=custom.json"]);
    assertEquals(matching.code, 0, matching.stderr);
    assertStringIncludes(matching.stdout, "god-class flags 0 class(es); legacy-score flags 1 class(es).");
    assertEquals(await Deno.readTextFile(policyPath), before);
    assertEquals(await Deno.readTextFile(customPath), before);
  });
});

Deno.test("god-objects-compare-policy-preserved: a reporter failure restores the exact policy bytes", async () => {
  await withCeilingProject(GOD_RULE, { "packages/x/src/small.ts": SMALL_CLASS }, async (dir) => {
    const path = join(dir, "unslop.config.json");
    const before = await Deno.readTextFile(path);
    await Deno.remove(join(dir, "rule_ceilings.json"));
    const failed = await compareOver(dir);
    assertEquals(failed.code === 0, false);
    assertStringIncludes(failed.stderr, "The report failed");
    assertEquals(await Deno.readTextFile(path), before);
  });
});

Deno.test("god-class-named-expression: the ceiling CLI rejects declarations and named expressions", async () => {
  const expressionPath = "packages/x/src/expression.ts";
  const declarationPath = "packages/x/src/declaration.ts";
  const expression = `import type { Other } from "./other.ts";\nexport const makeHub = ${godClassSource(GOD)};`;
  await withCeilingProject(GOD_RULE, { [declarationPath]: hub("Hub"), [expressionPath]: expression }, async (dir) => {
    const both = await gateOver(dir, KEY, "packages");
    assertEquals(both.code, 1);
    assertEquals(both.over.map((row) => [row.packageName, row.count]), [["packages/x", 2]]);
    await Deno.remove(join(dir, declarationPath));
    const expressionOnly = await gateOver(dir, KEY, "packages");
    assertEquals(expressionOnly.code, 1);
    assertEquals(expressionOnly.over.map((row) => [row.packageName, row.count]), [["packages/x", 1]]);
    await Deno.writeTextFile(
      join(dir, expressionPath),
      `export const makeSmall = ${SMALL_CLASS.replace("export ", "")};`,
    );
    const clean = await gateOver(dir, KEY, "packages");
    assertEquals(clean.code, 0);
    assertEquals(clean.over, []);
  });
});
