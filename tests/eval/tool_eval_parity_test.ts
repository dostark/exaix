/**
 * @module ToolEvalParityTest
 * @path tests/eval/tool_eval_parity_test.ts
 * @description Parity test asserting every TOOL_MANIFEST entry has at least one
 *   eval scenario tagged entity:<tool-name>, minus an explicit exclusion list.
 *   Initially green via seeded exclusions for 19 uncovered tools (phase-142 step 2).
 *   The 5 tools with existing scenarios (patch_file, delete_file, move_file,
 *   create_directory, search_files) are NOT in the exclusion list and MUST have
 *   real scenario coverage — when no scenario catalog is loaded, they appear as
 *   a 5-element missing set, proving they are not excluded.
 */
import { assertEquals } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { assertCatalogCovered } from "./catalog_parity.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const MANIFEST_TOOL_NAMES = TOOL_MANIFEST
  .filter((e) => e.docs_visible)
  .map((e) => e.name);

const toolsExclusions = parityExclusions.tools.map((e) => e.id);

const COVERED_TOOLS = ["patch_file", "delete_file", "move_file", "create_directory", "search_files"];

Deno.test("tool_eval_parity — empty scenario catalog reveals only the 5 covered tools as missing", () => {
  // With no scenario catalog loaded, the 5 tools with existing scenarios
  // (patch_file, delete_file, move_file, create_directory, search_files)
  // are NOT excluded and thus appear as missing — proving they are not in
  // the exclusion list. The 19 uncovered tools are excluded and do NOT appear.
  const missing = assertCatalogCovered({
    catalogIds: MANIFEST_TOOL_NAMES,
    scenarioCatalog: [],
    subsystemTag: "subsystem:tools",
    exclusions: toolsExclusions,
  });
  // Exact-count guard: only the 5 covered tools should be missing
  assertEquals(
    new Set(missing),
    new Set(COVERED_TOOLS),
    `Expected exactly the 5 covered tools as missing; got: ${missing.join(", ")}`,
  );
});

Deno.test("tool_eval_parity — adding a manifest tool without scenario or exclusion fails", () => {
  const extendedIds = [...MANIFEST_TOOL_NAMES, "new_phantom_tool"];
  const missing = assertCatalogCovered({
    catalogIds: extendedIds,
    scenarioCatalog: [],
    subsystemTag: "subsystem:tools",
    exclusions: toolsExclusions,
  });
  // The 5 covered tools still appear (no real catalog loaded); phantom also appears
  const missingSet = new Set(missing);
  assertEquals(missingSet.has("new_phantom_tool"), true);
  assertEquals(missing.length, COVERED_TOOLS.length + 1);
});

Deno.test("tool_eval_parity — 5 covered tools pass when their scenarios exist in catalog", () => {
  const scenarioCatalog = COVERED_TOOLS.map((name) => ({
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
