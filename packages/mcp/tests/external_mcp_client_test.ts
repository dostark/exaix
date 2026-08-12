/**
 * @module ExternalMcpClientTest
 * @path packages/mcp/tests/external_mcp_client_test.ts
 * @description Unit tests for `ExternalMcpClient`'s dual-transport connect,
 * list, and call, run against real local MCP servers — never mocks. The
 * Streamable HTTP path uses the official `@modelcontextprotocol/server` SDK
 * (`McpServer` + `createMcpHandler`, served via `Deno.serve`). The legacy SSE
 * fallback path uses a minimal in-file fixture modeled on the real,
 * currently-deployed wire contract read from
 * `docker/mcp-server/server/server.py` (`/sse` GET + `/messages` POST) — the
 * reusable `packages/mcp/tests/fixtures/` module is Step 4's deliverable, not
 * yet built, so this file starts/stops its own servers directly, exactly as
 * Step 2's Planned Tests direct.
 * @architectural-layer MCP
 * @dependencies [@exaix/mcp, @modelcontextprotocol/client, @modelcontextprotocol/server, zod]
 * @related-files [packages/mcp/src/external_mcp_client.ts, packages/mcp/src/i_external_mcp_client.ts]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { Client, SSEClientTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ExternalMcpClient } from "@exaix/mcp";

const ECHO_TOOL_TEXT_PREFIX = "echo: ";
const STRUCTURED_TOOL_CURRENCY = "USD";

/** Real Streamable HTTP MCP server (official SDK), served on an ephemeral port. */
function startStreamableReferenceServer(): { url: URL; stop: () => Promise<void> } {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "exaix-test-reference-server", version: "1.0.0" });

    server.registerTool(
      "echo",
      { description: "Echoes its input back", inputSchema: z.object({ text: z.string() }) },
      ({ text }) => Promise.resolve({ content: [{ type: "text", text: `${ECHO_TOOL_TEXT_PREFIX}${text}` }] }),
    );

    server.registerTool(
      "fail",
      { description: "Always returns isError: true", inputSchema: z.object({}) },
      () => Promise.resolve({ content: [{ type: "text", text: "deliberate failure" }], isError: true }),
    );

    server.registerTool(
      "totals",
      {
        description: "Returns a structured total alongside its text content",
        inputSchema: z.object({ amount: z.number() }),
        outputSchema: z.object({ amount: z.number(), currency: z.string() }),
      },
      ({ amount }) =>
        Promise.resolve({
          content: [{ type: "text", text: `Total: ${amount} ${STRUCTURED_TOOL_CURRENCY}` }],
          structuredContent: { amount, currency: STRUCTURED_TOOL_CURRENCY },
        }),
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

/**
 * Minimal hand-rolled legacy SSE MCP server — NOT the official SDK (the v2
 * server SDK never serves the legacy transport, per its own migration docs).
 * Modeled on the real, currently-deployed wire contract:
 * `docker/mcp-server/server/server.py`'s `SseServerTransport` — a `GET /sse`
 * that opens an `EventSource` and announces a POST endpoint via an
 * `event: endpoint` message, then `POST /messages` for outbound requests
 * with JSON-RPC responses delivered back over the open SSE stream. The
 * *same* URL is used for both the (failing) Streamable HTTP attempt and the
 * (succeeding) SSE attempt, exactly as `ExternalMcpClient.connect()` does —
 * any HTTP method other than the two above 404s, which is what makes the
 * Streamable HTTP attempt fail and the SSE attempt succeed.
 */
function startLegacySseReferenceServer(): { url: URL; stop: () => Promise<void> } {
  const encoder = new TextEncoder();
  let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const sendSseMessage = (event: string | undefined, data: string): void => {
    const framed = `${event ? `event: ${event}\n` : ""}data: ${data}\n\n`;
    sseController?.enqueue(encoder.encode(framed));
  };

  const handleGetSse = (): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
        sendSseMessage("endpoint", "/messages");
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  };

  const handlePostMessages = async (req: Request) => {
    const body = await req.json();
    if (body.method === "initialize") {
      sendSseMessage(
        undefined,
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "exaix-legacy-sse-fixture", version: "1.0.0" },
          },
        }),
      );
    } else if (body.method === "tools/list") {
      sendSseMessage(undefined, JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
    }
    return new Response(null, { status: 202 });
  };

  const httpServer = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/sse") return handleGetSse();
    if (req.method === "POST" && url.pathname === "/messages") return handlePostMessages(req);
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  const { port } = httpServer.addr as Deno.NetAddr;
  return {
    url: new URL(`http://127.0.0.1:${port}/sse`),
    stop: () => httpServer.shutdown(),
  };
}

Deno.test("ExternalMcpClient - connects over Streamable HTTP when the server supports it", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    assertEquals(client.activeTransport, "streamable-http");
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - falls back to SSE when Streamable HTTP connect fails", async () => {
  const reference = startLegacySseReferenceServer();
  const constructionLog: string[] = [];
  const client = new ExternalMcpClient({
    ClientCtor: class extends Client {
      constructor(...args: ConstructorParameters<typeof Client>) {
        constructionLog.push("client");
        super(...args);
      }
    },
    StreamableHTTPTransportCtor: class extends StreamableHTTPClientTransport {
      constructor(...args: ConstructorParameters<typeof StreamableHTTPClientTransport>) {
        constructionLog.push("streamable-http");
        super(...args);
      }
    },
    SSETransportCtor: class extends SSEClientTransport {
      constructor(...args: ConstructorParameters<typeof SSEClientTransport>) {
        constructionLog.push("sse");
        super(...args);
      }
    },
  });
  try {
    await client.connect(reference.url);
    assertEquals(client.activeTransport, "sse");
    assertEquals(constructionLog, ["client", "streamable-http", "client", "sse"]);
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - throws a combined error when both transports fail", async () => {
  const reference = startLegacySseReferenceServer();
  await reference.stop();
  const client = new ExternalMcpClient();
  await assertRejects(() => client.connect(reference.url));
});

Deno.test("ExternalMcpClient - listTools returns the server's real tool definitions", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    const tools = await client.listTools();
    assertEquals(tools.map((t) => t.name).toSorted(), ["echo", "fail", "totals"]);
    const echoTool = tools.find((t) => t.name === "echo");
    assertExists(echoTool);
    assertEquals(echoTool.description, "Echoes its input back");
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - callTool invokes the named tool and returns its content", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    const result = await client.callTool("echo", { text: "hello" });
    assertEquals(result.content, [{ type: "text", text: `${ECHO_TOOL_TEXT_PREFIX}hello` }]);
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - callTool preserves structuredContent when the server tool declares an outputSchema", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    const result = await client.callTool("totals", { amount: 42 });
    assertEquals(result.structuredContent, { amount: 42, currency: STRUCTURED_TOOL_CURRENCY });
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - callTool on a tool that reports failure surfaces isError, not a thrown exception", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    const result = await client.callTool("fail", {});
    assertEquals(result.isError, true);
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - callTool on an unknown tool name throws (protocol-level failure, per the SDK's documented contract)", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    await assertRejects(() => client.callTool("does-not-exist", {}));
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - close() tears down the transport cleanly", async () => {
  const reference = startStreamableReferenceServer();
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url);
    assertEquals(client.activeTransport, "streamable-http");
    await client.close();
    assertEquals(client.activeTransport, undefined);
    await assertRejects(() => client.listTools());
  } finally {
    await reference.stop();
  }
});
