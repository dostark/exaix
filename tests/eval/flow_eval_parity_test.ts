/**
 * @module FlowEvalParityTest
 * @path tests/eval/flow_eval_parity_test.ts
 * @description Parity test asserting every `Blueprints/Flows/*.flow.yaml` has at least one eval
 *   scenario tagged `entity:<flow-id>.flow`, minus reasoned exclusions.
 *
 *   Rewritten in Phase 142 after the gate was found unable to fail. It hardcoded sixteen flow ids
 *   and asserted `flowBlueprintIds.length === 16` — an array compared to a literal in the same
 *   file. Its two coverage checks were tautologies: one passed an EMPTY scenario list and asserted
 *   everything was missing, the other built the scenario list from the ids themselves, so adding a
 *   flow changed both sides at once.
 *
 *   What that concealed: **thirteen of the sixteen hardcoded ids were wrong.** The flows are
 *   `api-design`, `code-review`, `bug-investigation` — hyphens — while the list, and the `entity:`
 *   tags on the scenarios, said `api_design`, `code_review`, `bug_investigation`. The tags had been
 *   derived from each scenario's FILENAME rather than from the flow it requests, so
 *   `eval report --group-by entity` was reporting rows for entities that do not exist. Both sides
 *   of the comparison carried the same error, which is exactly why a tautological gate is worse
 *   than no gate: it certifies the mistake.
 * @architectural-layer Test
 * @related-files [tests/eval/catalog_parity.ts, tests/scenario_framework/runner/scenario_catalog.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { assertCatalogCovered } from "./catalog_parity.ts";
import { loadScenarioCatalog } from "../scenario_framework/runner/scenario_catalog.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FLOWS_DIR = join(REPO_ROOT, "Blueprints", "Flows");
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");

/** The suffix a flow's entity tag carries, distinguishing it from an agent role or tool of that name. */
const FLOW_ENTITY_SUFFIX = ".flow";

// The shipped flow catalog, read from each file's declared `id` rather than its filename. The id
// is what `assertFlowExists` resolves and what a request's `flow:` frontmatter must match, so it
// is the only name that means anything — deriving ids from filenames produced wrong entries before.
async function readFlowCatalog(): Promise<string[]> {
  const ids: string[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    const parsed = parseYaml(await Deno.readTextFile(join(FLOWS_DIR, entry.name))) as { id?: string };
    if (parsed?.id) ids.push(parsed.id);
  }
  return ids.sort();
}

const flowExclusions: string[] = (parityExclusions.flows ?? []).map((e: { id: string }) => e.id);

Deno.test("flow_eval_parity — the catalog is read from disk, not restated here", async () => {
  const ids = await readFlowCatalog();
  assert(ids.length > 0, "no flows found; the reader is checking nothing");
  // Asserting the SHAPE rather than a count keeps this from becoming the `length === 16` tautology
  // it replaces, while still catching a filename-derived id.
  const underscored = ids.filter((id) => id.includes("_"));
  assertEquals(underscored, [], `flow ids are hyphenated; these look filename-derived: ${underscored.join(", ")}`);
});

Deno.test("flow_eval_parity — every shipped flow has a real scenario, or a reasoned exclusion", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const flowIds = await readFlowCatalog();

  const missing = assertCatalogCovered({
    catalogIds: flowIds.map((id) => `${id}${FLOW_ENTITY_SUFFIX}`),
    scenarioCatalog: catalog.map((scenario) => ({ id: scenario.id, tags: scenario.tags })),
    subsystemTag: "subsystem:flows",
    exclusions: flowExclusions,
  });

  assertEquals(
    missing.sort(),
    [],
    `these flows ship with no scenario tagged entity:<id>.flow and no reasoned exclusion:\n${missing.join("\n")}`,
  );
});

Deno.test("flow_eval_parity — every flow entity tag names a flow that exists", async () => {
  // The other direction, and the one that caught the real defect: a tag naming a flow the catalog
  // does not have produces a phantom row in `eval report --group-by entity`.
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const known = new Set(await readFlowCatalog());

  const phantom: string[] = [];
  for (const scenario of catalog) {
    for (const tag of scenario.tags) {
      if (!tag.startsWith("entity:") || !tag.endsWith(FLOW_ENTITY_SUFFIX)) continue;
      const flowId = tag.slice("entity:".length, -FLOW_ENTITY_SUFFIX.length);
      if (!known.has(flowId)) phantom.push(`${scenario.id}: ${tag}`);
    }
  }

  assertEquals(
    [...new Set(phantom)].sort(),
    [],
    `entity tags naming no shipped flow — these become phantom rows in the entity report:\n${phantom.join("\n")}`,
  );
});
