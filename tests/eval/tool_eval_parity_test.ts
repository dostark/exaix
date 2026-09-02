/**
 * @module ToolEvalParityTest
 * @path tests/eval/tool_eval_parity_test.ts
 * @description Parity test asserting every docs-visible `TOOL_MANIFEST` entry has at least one
 *   eval scenario tagged `entity:<tool-name>`, minus reasoned exclusions.
 *
 *   Rewritten in Phase 142. The manifest side was always read from source, but every assertion
 *   compared it against a SYNTHETIC scenario catalog — empty in two tests, and in a third built
 *   from the manifest names themselves, so adding a tool changed both sides at once. The gate
 *   therefore never once looked at a real scenario, and its four checks duplicated
 *   `catalog_parity_harness_test.ts`, which already covers `assertCatalogCovered`'s behaviour with
 *   synthetic input across five cases. Duplicated harness coverage inside a parity file is
 *   maintenance cost that buys nothing: it fails when the helper changes and stays green when the
 *   coverage it is named for rots away.
 * @architectural-layer Test
 * @related-files [tests/eval/catalog_parity.ts, tests/eval/catalog_parity_harness_test.ts, packages/mcp/src/manifest.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolName } from "@exaix/core";
import { assertCatalogCovered } from "./catalog_parity.ts";
import { loadScenarioCatalog } from "../scenario_framework/runner/scenario_catalog.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");

const MANIFEST_TOOL_NAMES = TOOL_MANIFEST.filter((e) => e.docs_visible).map((e) => e.name);

const toolsExclusions: string[] = (parityExclusions.tools ?? []).map((e: { id: string }) => e.id);

Deno.test("tool_eval_parity — every docs-visible tool has a real scenario, or a reasoned exclusion", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  assert(MANIFEST_TOOL_NAMES.length > 0, "no docs-visible tools in the manifest; the reader checks nothing");

  const missing = assertCatalogCovered({
    catalogIds: MANIFEST_TOOL_NAMES,
    scenarioCatalog: catalog.map((scenario) => ({ id: scenario.id, tags: scenario.tags })),
    subsystemTag: "subsystem:tools",
    exclusions: toolsExclusions,
  });

  assertEquals(
    missing.sort(),
    [],
    `these tools ship with no scenario tagged entity:<name> and no reasoned exclusion:\n${missing.join("\n")}`,
  );
});

Deno.test("tool_eval_parity — every tool entity tag names a tool that exists", async () => {
  // The other direction: a tag naming no manifest entry becomes a phantom row in
  // `eval report --group-by entity`. Flow tags carried exactly this defect for thirteen entries.
  // A valid name is either an MCP-manifest tool or a Solo-only ReAct tool (ToolName).
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const known = new Set([...TOOL_MANIFEST.map((e) => e.name), ...Object.values(ToolName)]);

  const phantom: string[] = [];
  for (const scenario of catalog) {
    if (!scenario.tags.includes("subsystem:tools")) continue;
    for (const tag of scenario.tags) {
      if (!tag.startsWith("entity:")) continue;
      const name = tag.slice("entity:".length);
      if (!known.has(name)) phantom.push(`${scenario.id}: ${tag}`);
    }
  }

  assertEquals([...new Set(phantom)].sort(), [], `entity tags naming no manifest tool:\n${phantom.join("\n")}`);
});

Deno.test("tool_eval_parity — the tools exclusion list stays empty", () => {
  // Not a tautology: the list is data in `parity_exclusions.json`, and the claim is that no tool is
  // deliberately uncovered. An entry appearing here is a decision someone should have to defend.
  assertEquals(
    toolsExclusions,
    [],
    `every docs-visible tool is expected to carry eval coverage; excluded: ${toolsExclusions.join(", ")}`,
  );
});
