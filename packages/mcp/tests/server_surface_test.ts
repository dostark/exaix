/**
 * @module McpServerSurfaceTest
 * @path packages/mcp/tests/server_surface_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies the public @exaix-team/mcp-server subpath exposes the canonical MCP server/runtime surface.
 */

import { assertEquals } from "@std/assert";
import {
  buildDynamicHandlers,
  buildHandlers,
  discoverAllResources,
  generatePrompt,
  getPrompts,
  McpClient,
  MCPServer,
  parsePortalURI,
  ToolHandler,
} from "@exaix-team/mcp-server";

Deno.test("@exaix-team/mcp-server exports the canonical MCP server/runtime surface", () => {
  assertEquals(typeof MCPServer, "function");
  assertEquals(typeof McpClient, "function");
  assertEquals(typeof ToolHandler, "function");
  assertEquals(typeof buildHandlers, "function");
  assertEquals(typeof buildDynamicHandlers, "function");
  assertEquals(typeof discoverAllResources, "function");
  assertEquals(typeof parsePortalURI, "function");
  assertEquals(typeof generatePrompt, "function");
  assertEquals(typeof getPrompts, "function");
});
