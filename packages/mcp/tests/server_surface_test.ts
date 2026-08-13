/**
 * @module McpServerSurfaceTest
 * @path packages/mcp/tests/server_surface_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies the public @exaix/mcp/server subpath exposes the canonical MIT surface.
 */

import { assertEquals } from "@std/assert";
import { LocalToolDispatcher, ToolHandler } from "@exaix/mcp/server";

Deno.test("@exaix/mcp/server exports the canonical MCP client surface", () => {
  assertEquals(typeof LocalToolDispatcher, "function");
  assertEquals(typeof ToolHandler, "function");
});
