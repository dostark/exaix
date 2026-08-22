/**
 * @module ToolCatalogParityTest
 * @path packages/mcp/tests/tool_catalog_parity_test.ts
 * @description Fixture-based unit tests for checkToolCatalogParity() — the pure
 *   comparison function backing the `check:tool-catalog-parity` CI gate (Phase 154
 *   Step 1). Exercises the comparison logic in isolation from the real ToolRegistry
 *   and TOOL_MANIFEST catalogs; see tool_catalog_parity_real_catalogs_test.ts for
 *   the regression test pinned against the real catalogs.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/tool_catalog_parity.ts, packages/mcp/src/manifest.ts, packages/tool-runtime/src/tool_schemas.ts]
 */
import { assertEquals } from "@std/assert";
import { checkToolCatalogParity } from "@exaix/mcp/tool_catalog_parity.ts";
import type { ITool } from "@exaix/core/types";
import { ToolCategory, ToolKind, ToolSideEffectScope } from "@exaix/core";
import type { IToolManifestEntry } from "@exaix/mcp/manifest.ts";

/** Minimal ToolRegistry-shaped fixture; only `name` and `parameters` matter to the check. */
function registryTool(overrides: Partial<ITool> & { name: string }): ITool {
  return {
    description: "test tool",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    ...overrides,
  };
}

/** Minimal TOOL_MANIFEST-shaped fixture; only `name` and `input_schema` matter to the check. */
function manifestEntry(overrides: Partial<IToolManifestEntry> & { name: string }): IToolManifestEntry {
  return {
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.READ,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description: "test tool",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    ...overrides,
  };
}

Deno.test("[checkToolCatalogParity] required-param set mismatch produces a named errors entry", () => {
  const registryTools = [
    registryTool({
      name: "example_tool",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "example_tool",
      input_schema: {
        type: "object",
        properties: { portal: { type: "string" }, id: { type: "string" } },
        required: ["portal", "id"],
      },
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, false);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].includes("example_tool"), true);
});

Deno.test("[checkToolCatalogParity] matching required-param sets produce zero errors", () => {
  const registryTools = [
    registryTool({
      name: "example_tool",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "example_tool",
      input_schema: {
        type: "object",
        properties: {
          portal: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
          identity_id: { type: "string" },
        },
        required: ["portal", "path", "content", "identity_id"],
      },
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, true);
  assertEquals(result.errors, []);
});

Deno.test("[checkToolCatalogParity] MCP-only auth params (portal, identity_id) are excluded from comparison", () => {
  const registryTools = [
    registryTool({
      name: "example_tool",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "example_tool",
      input_schema: {
        type: "object",
        properties: { portal: { type: "string" }, path: { type: "string" }, identity_id: { type: "string" } },
        required: ["portal", "path", "identity_id"],
      },
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, true);
  assertEquals(result.errors, []);
});

Deno.test("[checkToolCatalogParity] ToolRegistry-only tool produces a warning, not an error", () => {
  const registryTools = [registryTool({ name: "deno_task" })];
  const manifestEntries: IToolManifestEntry[] = [];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, true);
  assertEquals(result.errors, []);
  assertEquals(result.warnings.length, 1);
  assertEquals(result.warnings[0].includes("deno_task"), true);
});
