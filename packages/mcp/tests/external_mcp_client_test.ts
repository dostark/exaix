/**
 * @module ExternalMcpClientTest
 * @path packages/mcp/tests/external_mcp_client_test.ts
 * @description Unit tests for `ExternalMcpClient`'s dual-transport connect,
 * list, and call, run against real local MCP servers — never mocks. Both
 * the Streamable HTTP and legacy SSE servers are the shared fixtures built
 * in Step 4 (`packages/mcp/tests/fixtures/`), reused here instead of the
 * in-file duplicates this file originally built before Step 4 existed.
 * Step 6 (v1.3) adds bearer-token auth coverage against the auth-gated
 * fixture built for this step.
 * @architectural-layer MCP
 * @dependencies [@exaix/mcp, @modelcontextprotocol/client]
 * @related-files [packages/mcp/src/external_mcp_client.ts, packages/mcp/src/i_external_mcp_client.ts, packages/mcp/tests/fixtures/reference_mcp_server.ts, packages/mcp/tests/fixtures/legacy_sse_reference_server.ts, packages/mcp/tests/fixtures/authenticated_reference_server.ts]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { Client, SSEClientTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ExternalMcpClient } from "@exaix/mcp";
import {
  ECHO_TOOL_TEXT_PREFIX,
  startReferenceServer as startStreamableReferenceServer,
  STRUCTURED_TOOL_CURRENCY,
} from "./fixtures/reference_mcp_server.ts";
import { startLegacySseReferenceServer } from "./fixtures/legacy_sse_reference_server.ts";
import { startAuthenticatedReferenceServer, WHOAMI_TOOL_IDENTITY } from "./fixtures/authenticated_reference_server.ts";

const AUTH_TEST_TOKEN = "test-bearer-token-secret";

Deno.test("ExternalMcpClient - connects over Streamable HTTP when the server supports it", async () => {
  const reference = await startStreamableReferenceServer();
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
  const reference = await startLegacySseReferenceServer();
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
  const reference = await startLegacySseReferenceServer();
  await reference.stop();
  const client = new ExternalMcpClient();
  await assertRejects(() => client.connect(reference.url));
});

Deno.test("ExternalMcpClient - listTools returns the server's real tool definitions", async () => {
  const reference = await startStreamableReferenceServer();
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
  const reference = await startStreamableReferenceServer();
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
  const reference = await startStreamableReferenceServer();
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
  const reference = await startStreamableReferenceServer();
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
  const reference = await startStreamableReferenceServer();
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
  const reference = await startStreamableReferenceServer();
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

Deno.test("ExternalMcpClient - connect() with a correct bearer token reaches an auth-gated server", async () => {
  const reference = await startAuthenticatedReferenceServer(AUTH_TEST_TOKEN);
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url, { bearerToken: AUTH_TEST_TOKEN });
    assertEquals(client.activeTransport, "streamable-http");
    const result = await client.callTool("whoami", {});
    assertEquals(result.content, [{ type: "text", text: WHOAMI_TOOL_IDENTITY }]);
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - connect() without a bearer token is rejected by an auth-gated server", async () => {
  const reference = await startAuthenticatedReferenceServer(AUTH_TEST_TOKEN);
  const client = new ExternalMcpClient();
  try {
    await assertRejects(() => client.connect(reference.url));
  } finally {
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - connect() refuses to send a bearer token over a plain http:// endpoint", async () => {
  const client = new ExternalMcpClient();
  await assertRejects(
    () => client.connect(new URL("http://example.com/mcp"), { bearerToken: AUTH_TEST_TOKEN }),
    Error,
    "refusing to send a bearer token over a non-HTTPS endpoint",
  );
});

Deno.test("ExternalMcpClient - connect() forwards the bearer token to the SSE fallback transport and authenticates", async () => {
  const reference = await startLegacySseReferenceServer(0, AUTH_TEST_TOKEN);
  const client = new ExternalMcpClient();
  try {
    await client.connect(reference.url, { bearerToken: AUTH_TEST_TOKEN });
    assertEquals(client.activeTransport, "sse");
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("ExternalMcpClient - connect() SSE fallback is rejected without a bearer token", async () => {
  const reference = await startLegacySseReferenceServer(0, AUTH_TEST_TOKEN);
  const client = new ExternalMcpClient();
  try {
    await assertRejects(() => client.connect(reference.url));
  } finally {
    await reference.stop();
  }
});
