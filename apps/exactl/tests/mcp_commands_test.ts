/**
 * @module MCPCommandsTest
 * @path apps/exactl/tests/mcp_commands_test.ts
 * @related-files [apps/exactl/src/commands/mcp_commands.ts]
 * @architectural-layer CLI
 * @description Verifies CLI commands for the MCP verb: starting the
 * inbound MCP server (delegating to exaix-team/apps/mcp-server/main.ts) and
 * connecting outbound to a real external MCP server via `connect()`. The
 * outbound tests run against a real local server built with the official
 * `@modelcontextprotocol/server` SDK — Step 4's reusable fixture module
 * doesn't exist yet, so this file starts/stops its own, matching Step 2's
 * precedent.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { McpCommands } from "../src/commands/mcp_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { TEST_MCP_PORT } from "@exaix/testing";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ExternalMcpClient, type IExternalMcpClient } from "@exaix/mcp";
import { startAuthenticatedReferenceServer, WHOAMI_TOOL_IDENTITY } from "@exaix/mcp/testing";
import { EXA_MCP_BEARER_TOKEN_ENV_VAR } from "../src/commands/constants.ts";
import { captureConsoleOutput } from "./helpers/console_utils.ts";

/** Real Streamable HTTP MCP server (official SDK), served on an ephemeral port. */
function startReferenceServer(): { url: URL; stop: () => Promise<void> } {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "exaix-mcp-commands-test-server", version: "1.0.0" });
    server.registerTool(
      "echo",
      { description: "Echoes its input back", inputSchema: z.object({ text: z.string() }) },
      ({ text }) => Promise.resolve({ content: [{ type: "text", text: `echo: ${text}` }] }),
    );
    return server;
  });
  const httpServer = Deno.serve({ port: 0, onListen: () => {} }, (req) => handler.fetch(req));
  const { port } = httpServer.addr as Deno.NetAddr;
  return {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    stop: async () => {
      await handler.close();
      await httpServer.shutdown();
    },
  };
}

/** Spies on `close()` so tests can assert teardown happened without a real socket. */
class SpyExternalMcpClient extends ExternalMcpClient {
  closeCalled = false;
  override close(): Promise<void> {
    this.closeCalled = true;
    return super.close();
  }
}

class ConnectSpyMcpCommands extends McpCommands {
  lastClient?: SpyExternalMcpClient;
  protected override createExternalMcpClient(): IExternalMcpClient {
    const client = new SpyExternalMcpClient();
    this.lastClient = client;
    return client;
  }
}

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
  assertEquals(args.includes("exaix-team/apps/mcp-server/main.ts"), true);
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

Deno.test("McpCommands.connect: --list-tools prints the real server's tool names", async () => {
  const { context, cleanup } = await createCliTestContext();
  const reference = startReferenceServer();
  const commands = new McpCommands(context);
  try {
    const output = await captureConsoleOutput(async () => {
      await commands.connect(reference.url.href, { listTools: true });
    });
    assertStringIncludes(output, "echo");
  } finally {
    await reference.stop();
    await cleanup();
  }
});

Deno.test("McpCommands.connect: --call-tool invokes the tool and prints its result", async () => {
  const { context, cleanup } = await createCliTestContext();
  const reference = startReferenceServer();
  const commands = new McpCommands(context);
  try {
    const output = await captureConsoleOutput(async () => {
      await commands.connect(reference.url.href, { callTool: "echo", args: '{"text":"hello"}' });
    });
    assertStringIncludes(output, "echo: hello");
  } finally {
    await reference.stop();
    await cleanup();
  }
});

Deno.test("McpCommands.connect: always closes the client, even when the requested action throws", async () => {
  const { context, cleanup } = await createCliTestContext();
  const reference = startReferenceServer();
  const commands = new ConnectSpyMcpCommands(context);
  try {
    await assertRejects(() => commands.connect(reference.url.href, { callTool: "does-not-exist" }));
    assertEquals(commands.lastClient?.closeCalled, true);
  } finally {
    await reference.stop();
    await cleanup();
  }
});

Deno.test("[security] McpCommands.connect: a malformed --args JSON payload produces a clear CLI error, not an uncaught exception", async () => {
  const { context, cleanup } = await createCliTestContext();
  const commands = new McpCommands(context);
  try {
    await assertRejects(
      () => commands.connect("http://127.0.0.1:1/mcp", { callTool: "echo", args: "{not valid json" }),
      Error,
      "Invalid --args JSON",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[security] McpCommands.connect: an invalid <url> argument produces a clear CLI error, not an uncaught exception", async () => {
  const { context, cleanup } = await createCliTestContext();
  const commands = new McpCommands(context);
  try {
    await assertRejects(
      () => commands.connect("not a valid url", { listTools: true }),
      Error,
      "Invalid <url> argument",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("McpCommands.connect: reads EXA_MCP_BEARER_TOKEN and passes it through to ExternalMcpClient.connect()", async () => {
  const { context, cleanup } = await createCliTestContext();
  const token = "test-cli-bearer-token";
  const reference = await startAuthenticatedReferenceServer(token);
  const commands = new McpCommands(context);
  Deno.env.set(EXA_MCP_BEARER_TOKEN_ENV_VAR, token);
  try {
    const output = await captureConsoleOutput(async () => {
      await commands.connect(reference.url.href, { callTool: "whoami", args: "{}" });
    });
    assertStringIncludes(output, WHOAMI_TOOL_IDENTITY);
  } finally {
    Deno.env.delete(EXA_MCP_BEARER_TOKEN_ENV_VAR);
    await reference.stop();
    await cleanup();
  }
});
