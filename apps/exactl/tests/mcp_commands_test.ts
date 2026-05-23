/**
 * @module MCPCommandsTest
 * @path apps/exactl/tests/mcp_commands_test.ts
 * @description Verifies CLI commands for managing the MCP lifecycle, delegating
 * to the standalone apps/mcp-server/main.ts entry point.
 */

import { assertEquals } from "@std/assert";
import { McpCommands } from "../src/commands/mcp_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { TEST_MCP_PORT } from "@exaix/testing";

class TestMcpCommands extends McpCommands {
  capturedArgs: string[][] = [];
  shouldFail = false;

  protected override runDenoCommand(args: string[]): Promise<void> {
    this.capturedArgs.push(args);
    if (this.shouldFail) {
      return Promise.reject(new Error("MCP server exited with code 1"));
    }
    return Promise.resolve();
  }
}

Deno.test("McpCommands.start(sse): delegates with --transport sse and custom port", async () => {
  const { context, cleanup } = await createCliTestContext();
  const commands = new TestMcpCommands(context);

  await commands.start({ sse: true, port: TEST_MCP_PORT });

  assertEquals(commands.capturedArgs.length, 1);
  const args = commands.capturedArgs[0];
  assertEquals(args.includes("apps/mcp-server/main.ts"), true);
  assertEquals(args.includes("--transport"), true);
  assertEquals(args[args.indexOf("--transport") + 1], "sse");
  assertEquals(args.includes("--port"), true);
  assertEquals(args[args.indexOf("--port") + 1], String(TEST_MCP_PORT));
  await cleanup();
});

Deno.test("McpCommands.start(sse): uses default port when none provided", async () => {
  const { context, cleanup } = await createCliTestContext();
  const commands = new TestMcpCommands(context);

  await commands.start({ sse: true });

  assertEquals(commands.capturedArgs.length, 1);
  const args = commands.capturedArgs[0];
  assertEquals(args.includes("--transport"), true);
  assertEquals(args[args.indexOf("--transport") + 1], "sse");
  assertEquals(args.includes("--port"), false);
  await cleanup();
});

Deno.test("McpCommands.start: uses --transport stdio by default", async () => {
  const { context, cleanup } = await createCliTestContext();
  const commands = new TestMcpCommands(context);

  await commands.start({});

  assertEquals(commands.capturedArgs.length, 1);
  const args = commands.capturedArgs[0];
  assertEquals(args.includes("--transport"), true);
  assertEquals(args[args.indexOf("--transport") + 1], "stdio");
  assertEquals(args.includes("--port"), false);
  await cleanup();
});

Deno.test("McpCommands.start: throws on process failure", async () => {
  const { context, cleanup } = await createCliTestContext();
  const commands = new TestMcpCommands(context);
  commands.shouldFail = true;

  try {
    await commands.start({});
    assertEquals(true, false, "Expected start() to throw");
  } catch (error) {
    assertEquals((error as Error).message.includes("exited with code 1"), true);
  }
  await cleanup();
});
