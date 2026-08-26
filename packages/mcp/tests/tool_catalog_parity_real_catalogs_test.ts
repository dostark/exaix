/**
 * @module ToolCatalogParityRealCatalogsTest
 * @path packages/mcp/tests/tool_catalog_parity_real_catalogs_test.ts
 * @description [regression] Runs checkToolCatalogParity() against the REAL ToolRegistry
 *   catalog (createCoreToolSchemas()) and the REAL TOOL_MANIFEST. Through Steps 1-3 this
 *   asserted the known patch_file shape divergence WAS present, anchoring proof that Step 1's
 *   gate correctly caught it. Phase 154 Step 4 resolved all 4 required-param divergences the
 *   gate found (patch_file, move_file, list_directory, search_files) — this test now asserts
 *   the two independently maintained catalogs agree on required params for every overlapping
 *   tool, guarding against any future catalog edit silently reintroducing drift. Phase 112
 *   Step 4 extended checkToolCatalogParity to also compare side_effect_scope; this same
 *   assertion (zero errors) now covers that too, verified against all 14 real ReAct tools'
 *   canonical scopes assigned that step.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/tool_catalog_parity.ts, packages/mcp/src/manifest.ts, packages/tool-runtime/src/tool_schemas.ts]
 */
import { assertEquals } from "@std/assert";
import { checkToolCatalogParity } from "@exaix/mcp/tool_catalog_parity.ts";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { createCoreToolSchemas } from "@exaix/tool-runtime";

Deno.test("[regression] checkToolCatalogParity finds zero required-param or side-effect-scope divergences against the real catalogs", () => {
  const result = checkToolCatalogParity(createCoreToolSchemas(), TOOL_MANIFEST);

  assertEquals(result.errors, []);
  assertEquals(result.success, true);
});
