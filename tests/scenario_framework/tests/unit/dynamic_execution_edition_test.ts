/**
 * @module DynamicExecutionEditionTest
 * @path tests/scenario_framework/tests/unit/dynamic_execution_edition_test.ts
 * @description The dynamic_execution pack needs Team's MCP tool dispatch; a Solo daemon
 *   builds no dynamic executor, so a dynamic step fails with "undefined getToolDefinitions".
 *   Every scenario in the pack must declare edition: team so a Solo run skips it.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, tests/scenario_framework/runner/modes.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { walk } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";

const FRAMEWORK_HOME = resolve(import.meta.dirname!, "..", "..");
const DYNAMIC_PACK = join(FRAMEWORK_HOME, "scenarios", "dynamic_execution");

/** The subset of a scenario document this test reads. */
interface IScenarioEdition {
  id?: string;
  edition?: string;
}

Deno.test("[dynamic-edition] every dynamic_execution scenario declares edition team", async () => {
  const offenders: string[] = [];
  let count = 0;
  for await (const entry of walk(DYNAMIC_PACK, { exts: [".yaml"], includeDirs: false })) {
    const doc = parseYaml(await Deno.readTextFile(entry.path)) as IScenarioEdition;
    count++;
    if (doc?.edition !== "team") offenders.push(`${doc?.id ?? entry.name}: edition=${doc?.edition ?? "(none)"}`);
  }
  assert(count >= 10, `expected the dynamic_execution pack, found ${count} scenarios`);
  assertEquals(
    offenders.sort(),
    [],
    "dynamic steps need Team tool dispatch, so each must be team-gated:\n" + offenders.join("\n"),
  );
});
