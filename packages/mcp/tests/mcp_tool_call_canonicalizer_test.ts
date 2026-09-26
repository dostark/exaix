/**
 * @module McpToolCallCanonicalizerTest
 * @path packages/mcp/tests/mcp_tool_call_canonicalizer_test.ts
 * @description Tests for the shared MCP name/argument canonicalizer used by every MCP
 *   dispatch path: general-purpose aliases resolve to a registered handler, native names
 *   stay exact, and parameters normalize against the selected handler's own schema.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/mcp_tool_call_canonicalizer.ts, packages/core/src/types/tool_aliases.ts]
 */

import { assertEquals } from "@std/assert";
import { McpToolName, ToolCallEntryPoint } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import {
  canonicalizeMcpArguments,
  canonicalizeMcpToolCall,
  mcpAliasRewrittenPayload,
  resolveMcpToolName,
} from "@exaix/mcp/server";

interface IFakeHandler {
  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> };
}

function handler(name: string, properties: Record<string, JSONValue>): IFakeHandler {
  return { getToolDefinition: () => ({ name, description: "", inputSchema: { type: "object", properties } }) };
}

const TOOLS = new Map<string, IFakeHandler>([
  [McpToolName.READ_FILE, handler(McpToolName.READ_FILE, { portal: {}, agent_role: {}, path: {} })],
  [McpToolName.PORTAL_SYMBOLS, handler(McpToolName.PORTAL_SYMBOLS, { portal: {}, name: {}, kind: {} })],
]);

Deno.test("[mcp] a general-purpose alias resolves to its registered canonical handler", () => {
  assertEquals(resolveMcpToolName(TOOLS, "Read"), McpToolName.READ_FILE);
  assertEquals(resolveMcpToolName(TOOLS, "READ_FILE"), McpToolName.READ_FILE);
  assertEquals(resolveMcpToolName(TOOLS, "glob"), undefined);
});

Deno.test("[mcp] native names stay exact: retired names and case/whitespace variants resolve to nothing", () => {
  assertEquals(resolveMcpToolName(TOOLS, "query_symbols"), McpToolName.PORTAL_SYMBOLS);
  for (const name of ["exaix_portal_symbols", "list_symbols", " QUERY_SYMBOLS ", "Query_Symbols"]) {
    assertEquals(resolveMcpToolName(TOOLS, name), undefined, name);
    assertEquals(canonicalizeMcpToolCall(TOOLS, name, {}), undefined, name);
  }
});

Deno.test("[mcp] arguments normalize against the handler schema and auth keys pass through unchanged", () => {
  const resolved = canonicalizeMcpToolCall(TOOLS, "Read", { portal: "p", agent_role: "a", file_path: "x.ts" });
  assertEquals(resolved?.call.name, McpToolName.READ_FILE);
  assertEquals(resolved?.call.params, { portal: "p", agent_role: "a", path: "x.ts" });
  assertEquals(resolved?.call.renamedParams, [{ from: "file_path", to: "path" }]);
});

Deno.test("[mcp] query_symbols {query} normalizes to {name}; the canonical key wins a conflict", () => {
  const symbols = TOOLS.get(McpToolName.PORTAL_SYMBOLS)!;
  assertEquals(canonicalizeMcpArguments(symbols, undefined, McpToolName.PORTAL_SYMBOLS, { query: "g" }).params, {
    name: "g",
  });
  const conflict = canonicalizeMcpArguments(symbols, undefined, McpToolName.PORTAL_SYMBOLS, {
    query: "lose",
    name: "win",
  });
  assertEquals(conflict.params, { name: "win" });
  assertEquals(conflict.droppedParams, ["query"]);
});

Deno.test("[mcp] a requested alias name is carried as provenance in one combined rewrite", () => {
  const read = TOOLS.get(McpToolName.READ_FILE)!;
  const combined = canonicalizeMcpArguments(read, "Read", McpToolName.READ_FILE, { file_path: "x.ts" });
  assertEquals(mcpAliasRewrittenPayload(combined), {
    requestedName: "Read",
    canonicalName: McpToolName.READ_FILE,
    renamedParams: [{ from: "file_path", to: "path" }],
    droppedParams: [],
    entryPoint: ToolCallEntryPoint.MCP,
  });
  const canonical = canonicalizeMcpArguments(read, undefined, McpToolName.READ_FILE, { path: "x.ts" });
  assertEquals(canonical.rewritten, false);
});
