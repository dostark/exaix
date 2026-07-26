/**
 * @module CatalogLoadsTest
 * @path tests/eval/catalog_loads_test.ts
 * @description Asserts the real scenario catalog loads end-to-end. `loadScenarioCatalog`
 *   throws on the FIRST scenario whose `request_fixture` is missing, so a single bad
 *   reference makes every tag- and profile-based selection — the parity gates' view of the
 *   catalog, `deno task eval:subsystems`, and the whole ci-smoke profile — fail before a
 *   single scenario executes. Step 7's cutover probe found 14 such references; this test is
 *   the standing guard against reintroducing one.
 * @architectural-layer Test
 * @dependencies [tests/scenario_framework/runner/scenario_catalog.ts]
 * @related-files [tests/eval/tools_pack_contract_test.ts, tests/scenario_framework/runner/request_fixtures.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { loadScenarioCatalog } from "../scenario_framework/runner/scenario_catalog.ts";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");

/** Every subsystem the phase-142 taxonomy defines; each must be represented in the catalog. */
const SUBSYSTEMS = [
  "tools",
  "mcp-server",
  "mcp-client",
  "identities",
  "skills",
  "flows",
] as const;

Deno.test("catalog_loads — the real scenario catalog loads without a missing-fixture throw", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  assert(catalog.length > 0, "scenario catalog loaded but is empty");
});

Deno.test("catalog_loads — every subsystem tag is represented by at least one scenario", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const uncovered = SUBSYSTEMS.filter(
    (subsystem) => !catalog.some((entry) => entry.tags.includes(`subsystem:${subsystem}`)),
  );
  assertEquals(uncovered, [], `subsystems with no tagged scenario: ${uncovered.join(", ")}`);
});

Deno.test("catalog_loads — every scenario id is unique", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of catalog) {
    if (seen.has(entry.id)) duplicates.push(entry.id);
    seen.add(entry.id);
  }
  assertEquals(duplicates, [], `duplicate scenario ids: ${duplicates.join(", ")}`);
});
