/**
 * @module ToolRegistrationParityTest
 * @path tests/mcp/tool_registration_parity_test.ts
 * @description Verifies that every live MCP tool entry in the canonical manifest is actually
 * registered and returned by MCPServer tools/list, and vice versa.
 */

import { assertEquals, assertExists } from "@std/assert";
import { TOOL_MANIFEST, ToolKind } from "@exaix/mcp";
import { createMCPRequest, initMCPTestWithoutPortal } from "./helpers/test_setup.ts";

interface IToolsListResult {
  tools: Array<{ name: string; description: string }>;
}

Deno.test("ToolRegistrationParity: every live MCP manifest entry is registered by MCPServer", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("tools/list", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as IToolsListResult;
    const registeredNames = new Set(result.tools.map((t) => t.name));

    const liveManifestEntries = TOOL_MANIFEST.filter(
      (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
    );

    for (const entry of liveManifestEntries) {
      assertEquals(
        registeredNames.has(entry.name),
        true,
        `Manifest live tool '${entry.name}' is not registered in MCPServer`,
      );
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ToolRegistrationParity: every MCPServer tool is in the manifest", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("tools/list", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as IToolsListResult;
    const manifestNames = new Set(TOOL_MANIFEST.map((e) => e.name));

    for (const tool of result.tools) {
      assertEquals(
        manifestNames.has(tool.name),
        true,
        `MCPServer tool '${tool.name}' is not in TOOL_MANIFEST`,
      );
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ToolRegistrationParity: live MCP tool count matches manifest count", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("tools/list", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as IToolsListResult;
    const liveManifestCount = TOOL_MANIFEST.filter(
      (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
    ).length;

    assertEquals(
      result.tools.length,
      liveManifestCount,
      `MCPServer registers ${result.tools.length} tools but manifest has ${liveManifestCount} live entries`,
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ToolRegistrationParity: every tools/list description matches the canonical manifest", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("tools/list", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as IToolsListResult;

    const liveManifestEntries = TOOL_MANIFEST.filter(
      (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
    );

    const manifestByName = new Map(liveManifestEntries.map((e) => [e.name, e.description]));

    const mismatches: string[] = [];
    for (const tool of result.tools) {
      const expected = manifestByName.get(tool.name);
      if (expected === undefined) continue;
      if (tool.description !== expected) {
        mismatches.push(
          `'${tool.name}': served="${tool.description.slice(0, 60)}..." expected="${expected.slice(0, 60)}..."`,
        );
      }
    }

    assertEquals(
      mismatches,
      [],
      `tools/list descriptions do not match TOOL_MANIFEST for: [${mismatches.join("; ")}]. ` +
        `Update getToolDefinition() in each handler to match the manifest description.`,
    );
  } finally {
    await ctx.cleanup();
  }
});
