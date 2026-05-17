/**
 * @module ToolResultSchemaDiscoveryTest
 * @path tests/mcp/tool_result_schema_discovery_test.ts
 * @description Tests the exaix/tools/result_schema JSON-RPC method (Phase 78
 * Enforcement Point 5 / Option 2 discovery). Verifies that a client can request
 * the expected result schema for a tool and receive a ToolResultSchemaDescriptor.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ToolResultSchemaDescriptorSchema } from "@exaix/schemas/tool_result.ts";
import { createMCPRequest, initMCPTestWithoutPortal } from "./helpers/test_setup.ts";

interface ISchemaDiscoveryResult {
  tool?: string;
  schemaVersion?: string;
  remediationPolicy?: { tool?: string; mode?: string };
  experimental?: boolean;
}

// ============================================================================
// exaix/tools/result_schema — schema discovery endpoint
// ============================================================================

Deno.test("tool_result_schema_discovery: known tool returns schema descriptor", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("exaix/tools/result_schema", {
      tool: "run_command",
    });
    const response = await ctx.server.handleRequest(request);
    assertExists(response.result, "Expected result from exaix/tools/result_schema, got error");
    const descriptor = response.result as ISchemaDiscoveryResult;
    assertEquals(descriptor.tool, "run_command");
    assertExists(descriptor.schemaVersion, "Descriptor must include schemaVersion");
    assertExists(descriptor.remediationPolicy, "Descriptor must include remediationPolicy");
    // Must be parseable by ToolResultSchemaDescriptorSchema
    const parsed = ToolResultSchemaDescriptorSchema.safeParse(descriptor);
    assertEquals(parsed.success, true, `Descriptor failed schema parse: ${JSON.stringify(parsed)}`);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("tool_result_schema_discovery: unknown tool returns error response", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("exaix/tools/result_schema", {
      tool: "nonexistent_tool",
    });
    const response = await ctx.server.handleRequest(request);
    assertExists(
      response.error,
      "Unknown tool must return JSON-RPC error, not a result",
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("tool_result_schema_discovery: descriptor experimental flag is true", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("exaix/tools/result_schema", {
      tool: "search_files",
    });
    const response = await ctx.server.handleRequest(request);
    assertExists(response.result);
    const descriptor = response.result as ISchemaDiscoveryResult;
    assertEquals(descriptor.experimental, true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("tool_result_schema_discovery: missing tool param returns error", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("exaix/tools/result_schema", {});
    const response = await ctx.server.handleRequest(request);
    assertExists(
      response.error,
      "Request without 'tool' param must return JSON-RPC error",
    );
  } finally {
    await ctx.cleanup();
  }
});
