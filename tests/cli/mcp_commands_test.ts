/**
 * @module MCPCommandsTest
 * @path tests/cli/mcp_commands_test.ts
 * @description Verifies CLI commands for managing the MCP lifecycle, including server startup
 * via Stdio/SSE and registration of external provider endpoints.
 */

import { assertEquals } from "@std/assert";
import { MCPServer } from "@exaix/mcp/server";
import { McpCommands } from "../../apps/exactl/src/commands/mcp_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { TEST_MCP_DEFAULT_PORT, TEST_MCP_PORT } from "@exaix/testing";

Deno.test("McpCommands.start(sse): calls MCPServer.startHTTPServer with requested/default port", async () => {
  const { context, cleanup } = await createCliTestContext();

  const originalStart = MCPServer.prototype.start;
  const originalStartHTTP = MCPServer.prototype.startHTTPServer;

  try {
    let stdioStarted = false;
    const ports: number[] = [];

    MCPServer.prototype.start = function () {
      stdioStarted = true;
    };

    MCPServer.prototype.startHTTPServer = function (port: number) {
      ports.push(port);
      return Promise.resolve();
    };

    const commands = new McpCommands(context);

    await commands.start({ sse: true, port: TEST_MCP_PORT });
    await commands.start({ sse: true });

    assertEquals(stdioStarted, false);
    assertEquals(ports[0], TEST_MCP_PORT);
    assertEquals(ports[1], TEST_MCP_DEFAULT_PORT);
  } finally {
    MCPServer.prototype.start = originalStart;
    MCPServer.prototype.startHTTPServer = originalStartHTTP;
    await cleanup();
  }
});
