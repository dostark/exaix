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
          agent_role: { type: "string" },
        },
        required: ["portal", "path", "content", "agent_role"],
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
        properties: { portal: { type: "string" }, path: { type: "string" }, agent_role: { type: "string" } },
        required: ["portal", "path", "agent_role"],
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

Deno.test("[checkToolCatalogParity] side-effect scope mismatch produces a blocking error when both catalogs declare a scope", () => {
  const registryTools = [
    registryTool({
      name: "example_tool",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      sideEffectScope: ToolSideEffectScope.PORTAL,
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "example_tool",
      side_effect_scope: ToolSideEffectScope.NONE,
      input_schema: {
        type: "object",
        properties: { portal: { type: "string" }, path: { type: "string" } },
        required: ["portal", "path"],
      },
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, false);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].includes("example_tool"), true);
  assertEquals(result.errors[0].includes("side-effect"), true);
});

Deno.test("[checkToolCatalogParity] side-effect scope mismatch is caught even when the manifest entry has no input_schema (internal-only tool, mirroring fetch_url)", () => {
  const registryTools = [
    registryTool({
      name: "fetch_url_like",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      sideEffectScope: ToolSideEffectScope.NETWORK,
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "fetch_url_like",
      side_effect_scope: ToolSideEffectScope.NONE,
      // No input_schema — mirrors the real fetch_url/grep_search/copy_file internal-only entries.
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, false);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].includes("fetch_url_like"), true);
  assertEquals(result.errors[0].includes("side-effect"), true);
});

Deno.test("[checkToolCatalogParity] matching side-effect scopes produce zero errors", () => {
  const registryTools = [
    registryTool({
      name: "example_tool",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      sideEffectScope: ToolSideEffectScope.PORTAL,
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "example_tool",
      side_effect_scope: ToolSideEffectScope.PORTAL,
      input_schema: {
        type: "object",
        properties: { portal: { type: "string" }, path: { type: "string" } },
        required: ["portal", "path"],
      },
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, true);
  assertEquals(result.errors, []);
});

Deno.test("[checkToolCatalogParity] a ToolRegistry tool with no declared sideEffectScope is not flagged (compatibility-safe optional field)", () => {
  const registryTools = [
    registryTool({
      name: "example_tool",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    }),
  ];
  const manifestEntries = [
    manifestEntry({
      name: "example_tool",
      side_effect_scope: ToolSideEffectScope.PORTAL,
      input_schema: {
        type: "object",
        properties: { portal: { type: "string" }, path: { type: "string" } },
        required: ["portal", "path"],
      },
    }),
  ];

  const result = checkToolCatalogParity(registryTools, manifestEntries);

  assertEquals(result.success, true);
  assertEquals(result.errors, []);
});
