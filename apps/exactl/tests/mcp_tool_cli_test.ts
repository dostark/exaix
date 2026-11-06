/**
 * @module McpToolCliTest
 * @path apps/exactl/tests/mcp_tool_cli_test.ts
 * @description Runs the real exactl binary against mcp tool list and mcp tool call with a real reference MCP server.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/mcp/testing, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/mcp_command.ts, apps/exactl/src/commands/mcp_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { startReferenceServer } from "@exaix/mcp/testing";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const USAGE_EXIT_CODE = 2;

Deno.test({
  name: "mcp tool list --server lists the remote tools",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const reference = await startReferenceServer();
    try {
      const [run] = await runExactlSequenceInTempWorkspace([["mcp", "tool", "list", "--server", reference.url.href]]);
      assertEquals(run.code, 0, run.stderr);
      assertStringIncludes(run.stdout, "echo");
    } finally {
      await reference.stop();
    }
  },
});

Deno.test({
  name: "mcp tool call round-trips a tool call with --args",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const reference = await startReferenceServer();
    try {
      const [run] = await runExactlSequenceInTempWorkspace([
        ["mcp", "tool", "call", "echo", "--server", reference.url.href, "--args", '{"text":"hello"}'],
      ]);
      assertEquals(run.code, 0, run.stderr);
      assertStringIncludes(run.stdout, "echo: hello");
    } finally {
      await reference.stop();
    }
  },
});

Deno.test("mcp tool list without --server exits 2", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["mcp", "tool", "list"]]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
});
