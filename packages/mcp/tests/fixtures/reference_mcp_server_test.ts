/**
 * @module ReferenceMcpServerFixtureTest
 * @path packages/mcp/tests/fixtures/reference_mcp_server_test.ts
 * @description Proves `startReferenceServer`/`startLegacySseReferenceServer`
 * are valid, independent MCP servers — queried with the official SDK's own
 * raw `Client`, bypassing `ExternalMcpClient` entirely, so a bug in
 * `ExternalMcpClient` could never make these fixtures look correct when
 * they are not.
 * @architectural-layer MCP
 * @dependencies [@modelcontextprotocol/client]
 * @related-files [packages/mcp/tests/fixtures/reference_mcp_server.ts, packages/mcp/tests/fixtures/legacy_sse_reference_server.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ECHO_TOOL_TEXT_PREFIX, startReferenceServer, STRUCTURED_TOOL_CURRENCY } from "./reference_mcp_server.ts";
import { startLegacySseReferenceServer } from "./legacy_sse_reference_server.ts";

Deno.test("reference_mcp_server fixture - starts, serves real registered tools via the SDK's raw Client, and stops cleanly", async () => {
  const reference = await startReferenceServer();
  const client = new Client({ name: "fixture-verifier", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(reference.url));

    const { tools } = await client.listTools();
    assertEquals(tools.map((t) => t.name).toSorted(), ["echo", "fail", "totals"]);

    const echoed = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    assertEquals(echoed.content, [{ type: "text", text: `${ECHO_TOOL_TEXT_PREFIX}hi` }]);

    const failed = await client.callTool({ name: "fail", arguments: {} });
    assertEquals(failed.isError, true);

    const totals = await client.callTool({ name: "totals", arguments: { amount: 7 } });
    assertEquals(totals.structuredContent, { amount: 7, currency: STRUCTURED_TOOL_CURRENCY });
  } finally {
    await client.close();
    await reference.stop();
  }
});

Deno.test("legacy_sse_reference_server fixture - serves the endpoint handshake and an initialize response over the still-open SSE stream, and stops cleanly", async () => {
  const reference = await startLegacySseReferenceServer();
  try {
    const eventSourceResponse = await fetch(reference.url);
    assertEquals(eventSourceResponse.headers.get("content-type"), "text/event-stream");
    const reader = eventSourceResponse.body!.getReader();
    const decoder = new TextDecoder();

    // Real clients (SSEClientTransport) keep this GET stream open while POSTing —
    // the "endpoint" event and the JSON-RPC response both arrive over it.
    const { value: endpointChunk } = await reader.read();
    assertStringIncludes(decoder.decode(endpointChunk), "event: endpoint");
    assertStringIncludes(decoder.decode(endpointChunk), "data: /messages");

    const postResponse = await fetch(new URL("/messages", reference.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assertEquals(postResponse.status, 202);
    await postResponse.body?.cancel();

    const { value: responseChunk } = await reader.read();
    assertStringIncludes(decoder.decode(responseChunk), '"protocolVersion"');

    await reader.cancel();
  } finally {
    await reference.stop();
  }
});
