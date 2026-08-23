/**
 * @module ToolChoiceHintE2ETest
 * @path packages-team/mcp-server/tests/tool_choice_hint_e2e_test.ts
 * @description [integration] Phase 154 Step 6 — the non-deferrable proof that
 *   `preferred_tool_choice_hint` (Step 5) reaches a real MCP client through the real server
 *   construction path. `LocalToolDispatcher` (wired in this same step) is NOT what the real
 *   server's `tools/list` is built from — `MCPServer.buildSdkServer()` iterates its own
 *   `this.tools` map and calls `ToolHandler.getToolDefinition()` directly, bypassing
 *   `LocalToolDispatcher` entirely (confirmed by reading `server.ts`'s `buildSdkServer()`
 *   during this step's implementation — `LocalToolDispatcher` is a Flow/`DynamicStepExecutor`-only
 *   consumer, unrelated to the external-facing server). A separate test file from
 *   `server_test.ts`'s existing golden-fixture parity test, since adding hint text to
 *   `patch_file`'s description would break that test's byte-exact fixture comparison.
 * @architectural-layer MCP
 * @related-files [packages-team/mcp-server/server.ts, packages/mcp/src/manifest.ts]
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpToolName } from "@exaix/mcp";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { initMCPTestWithoutPortal } from "@exaix/mcp/testing";

interface IToolsListEntry {
  name: string;
  description: string;
}

Deno.test(
  "[integration] a real tools/list response from the official-SDK-based server includes patch_file's Step 5 hint text",
  async () => {
    const hint = TOOL_MANIFEST.find((e) => e.name === McpToolName.PATCH_FILE)?.preferred_tool_choice_hint;
    if (!hint) throw new Error("patch_file has no preferred_tool_choice_hint set (Step 5 regression)");

    const ctx = await initMCPTestWithoutPortal();
    try {
      const sdkServer = ctx.server.buildSdkServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "tool-choice-hint-e2e-client", version: "1.0.0" });
      await Promise.all([sdkServer.server.connect(serverTransport), client.connect(clientTransport)]);

      const toolsList = await client.request({ method: "tools/list", params: {} }, z.unknown()) as {
        tools: IToolsListEntry[];
      };
      const patchFileEntry = toolsList.tools.find((t) => t.name === McpToolName.PATCH_FILE);

      assertEquals(patchFileEntry !== undefined, true, "patch_file must be present in tools/list");
      assertEquals(
        patchFileEntry?.description.includes(hint),
        true,
        `patch_file's tools/list description must include the Step 5 hint text; got: ${patchFileEntry?.description}`,
      );

      await client.close();
      await sdkServer.server.close();
    } finally {
      await ctx.cleanup();
    }
  },
);
