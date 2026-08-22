/**
 * @module ToolCatalogParityRealCatalogsTest
 * @path packages/mcp/tests/tool_catalog_parity_real_catalogs_test.ts
 * @description [regression] Runs checkToolCatalogParity() against the REAL
 *   ToolRegistry catalog (createCoreToolSchemas()) and the REAL TOOL_MANIFEST,
 *   pinning the known patch_file shape divergence — ToolRegistry requires
 *   {path, patches[]}, the live MCP handler requires {path, search, replace}
 *   (packages-team/mcp-server/handlers/patch_file_tool.ts) — until Phase 154
 *   Step 4 resolves it. Guards against future catalog edits silently
 *   reintroducing (or masking) drift between the two independently maintained
 *   tool catalogs.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/tool_catalog_parity.ts, packages/mcp/src/manifest.ts, packages/tool-runtime/src/tool_schemas.ts]
 */
import { assertEquals } from "@std/assert";
import { checkToolCatalogParity } from "@exaix/mcp/tool_catalog_parity.ts";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { createCoreToolSchemas } from "@exaix/tool-runtime";

Deno.test("[regression] checkToolCatalogParity flags the known patch_file shape divergence against the real catalogs", () => {
  const result = checkToolCatalogParity(createCoreToolSchemas(), TOOL_MANIFEST);

  assertEquals(
    result.errors.some((error: string) => error.includes("patch_file")),
    true,
  );
});
