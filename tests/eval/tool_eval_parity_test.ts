/**
 * @module ToolEvalParityTest
 * @path tests/eval/tool_eval_parity_test.ts
 * @description Parity test asserting every TOOL_MANIFEST entry has at least one
 *   eval scenario tagged entity:<tool-name>, minus an explicit exclusion list.
 *   Step 2: tools exclusion list is empty — all 24 docs_visible tools are expected
 *   to have eval coverage via their entity:<tool> tags.
 */
import { assertEquals } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { assertCatalogCovered } from "./catalog_parity.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const MANIFEST_TOOL_NAMES = TOOL_MANIFEST
  .filter((e) => e.docs_visible)
  .map((e) => e.name);

const toolsExclusions: string[] = (parityExclusions.tools ?? []).map((e: { id: string }) => e.id);

Deno.test("tool_eval_parity — empty exclusions means all 24 tools are missing with no catalog", () => {
  assertEquals(toolsExclusions.length, 0, "Step 2 should have zero tool exclusions");
  const missing = assertCatalogCovered({
    catalogIds: MANIFEST_TOOL_NAMES,
    scenarioCatalog: [],
    subsystemTag: "subsystem:tools",
    exclusions: toolsExclusions,
  });
  assertEquals(missing.length, MANIFEST_TOOL_NAMES.length);
});

Deno.test("tool_eval_parity — adding a manifest tool without coverage fails", () => {
  const extendedIds = [...MANIFEST_TOOL_NAMES, "new_phantom_tool"];
  const missing = assertCatalogCovered({
    catalogIds: extendedIds,
    scenarioCatalog: [],
    subsystemTag: "subsystem:tools",
    exclusions: toolsExclusions,
  });
  const missingSet = new Set(missing);
  assertEquals(missingSet.has("new_phantom_tool"), true);
  assertEquals(missing.length, MANIFEST_TOOL_NAMES.length + 1);
});

Deno.test("tool_eval_parity — all 24 tools pass when their scenarios exist in catalog", () => {
  const scenarioCatalog = MANIFEST_TOOL_NAMES.map((name) => ({
    id: `${name}_test`,
    tags: ["subsystem:tools", `entity:${name}`],
  }));
  const missing = assertCatalogCovered({
    catalogIds: MANIFEST_TOOL_NAMES,
    scenarioCatalog,
    subsystemTag: "subsystem:tools",
    exclusions: toolsExclusions,
  });
  assertEquals(missing, []);
});

Deno.test("tool_eval_parity — covered by a single scenario passes", () => {
  const missing = assertCatalogCovered({
    catalogIds: ["read_file"],
    scenarioCatalog: [
      { id: "read_file_test", tags: ["subsystem:tools", "entity:read_file"] },
    ],
    subsystemTag: "subsystem:tools",
    exclusions: [],
  });
  assertEquals(missing, []);
});
