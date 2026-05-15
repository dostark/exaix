/**
 * @module ToolSchemaEnumParityTest
 * @path tests/mcp/tool_schema_enum_parity_test.ts
 * @description Verifies bidirectional parity between the McpToolName enum and live MCP entries
 * in the canonical tool manifest. Every McpToolName value must have a manifest entry and vice
 * versa. Step 77.2 normalization tests.
 */

import { assert, assertEquals } from "@std/assert";
import { McpToolName, TOOL_MANIFEST, ToolKind } from "@exaix/mcp";

Deno.test("ToolSchemaEnumParity: every McpToolName value has a live manifest entry", () => {
  const liveMcpNames = new Set(
    TOOL_MANIFEST
      .filter((e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN)
      .map((e) => e.name),
  );
  for (const toolName of Object.values(McpToolName)) {
    assert(
      liveMcpNames.has(toolName),
      `McpToolName value "${toolName}" has no matching live manifest entry — dead enum entry`,
    );
  }
});

Deno.test("ToolSchemaEnumParity: every live manifest MCP entry has a McpToolName value", () => {
  const mcpValues = new Set(Object.values(McpToolName) as string[]);
  const liveEntries = TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
  );
  for (const entry of liveEntries) {
    assert(
      mcpValues.has(entry.name),
      `Live manifest entry "${entry.name}" has no McpToolName enum value`,
    );
  }
});

Deno.test("ToolSchemaEnumParity: McpToolName count equals live manifest MCP count", () => {
  const liveCount = TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
  ).length;
  assertEquals(
    Object.values(McpToolName).length,
    liveCount,
    `McpToolName has ${Object.values(McpToolName).length} entries but manifest has ${liveCount} live MCP tools`,
  );
});
