/**
 * @module ToolRegistrationParityTest
 * @path tests/mcp/tool_registration_parity_test.ts
 * @description Verifies that every live MCP tool entry in the canonical manifest is actually
 * registered and returned by MCPServer tools/list, and vice versa.
 */

import { assertEquals, assertExists } from "@std/assert";
import { TOOL_MANIFEST, ToolKind } from "@exaix/mcp";
import { LIVE_MCP_TOOL_FACTORIES } from "@exaix/mcp/server";
import { createMCPRequest, initMCPTestWithoutPortal } from "./helpers/test_setup.ts";

interface IToolsListResult {
  tools: Array<{ name: string; description: string }>;
}

const LIVE_MANIFEST_ENTRIES = TOOL_MANIFEST.filter(
  (entry) => entry.kind === ToolKind.MCP_HANDLER || entry.kind === ToolKind.MCP_DOMAIN,
);

async function withToolsListResult(fn: (result: IToolsListResult) => void | Promise<void>): Promise<void> {
  const ctx = await initMCPTestWithoutPortal();

  try {
    const request = createMCPRequest("tools/list", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    await fn(response.result as IToolsListResult);
  } finally {
    await ctx.cleanup();
  }
}

Deno.test("ToolRegistrationParity: manifest-owned factory registry covers every live MCP tool exactly once", () => {
  const liveManifestNames = LIVE_MANIFEST_ENTRIES
    .map((entry) => entry.name)
    .sort();

  const factoryNames = [...LIVE_MCP_TOOL_FACTORIES.keys()].sort();

  assertEquals(
    factoryNames,
    liveManifestNames,
    "LIVE_MCP_TOOL_FACTORIES must be the single keyed registration surface for all live MCP tools.",
  );
});

Deno.test("ToolRegistrationParity: every live MCP manifest entry is registered by MCPServer", async () => {
  await withToolsListResult((result) => {
    const registeredNames = new Set(result.tools.map((tool) => tool.name));

    for (const entry of LIVE_MANIFEST_ENTRIES) {
      assertEquals(
        registeredNames.has(entry.name),
        true,
        `Manifest live tool '${entry.name}' is not registered in MCPServer`,
      );
    }
  });
});

Deno.test("ToolRegistrationParity: every MCPServer tool is in the manifest", async () => {
  await withToolsListResult((result) => {
    const manifestNames = new Set(TOOL_MANIFEST.map((e) => e.name));

    for (const tool of result.tools) {
      assertEquals(
        manifestNames.has(tool.name),
        true,
        `MCPServer tool '${tool.name}' is not in TOOL_MANIFEST`,
      );
    }
  });
});

Deno.test("ToolRegistrationParity: live MCP tool count matches manifest count", async () => {
  await withToolsListResult((result) => {
    const liveManifestCount = LIVE_MANIFEST_ENTRIES.length;

    assertEquals(
      result.tools.length,
      liveManifestCount,
      `MCPServer registers ${result.tools.length} tools but manifest has ${liveManifestCount} live entries`,
    );
  });
});

Deno.test("ToolRegistrationParity: every tools/list description matches the canonical manifest", async () => {
  await withToolsListResult((result) => {
    const manifestByName = new Map(LIVE_MANIFEST_ENTRIES.map((entry) => [entry.name, entry.description]));

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
  });
});
