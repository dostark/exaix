/**
 * @module MCPServerTest
 * @path packages-team/mcp-server/tests/server_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Suite for the Exaix Model Context Protocol (MCP) server, verifying
 * initialization routines, transport layer integrity (Stdio/SSE), and core session management.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { z } from "zod";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toSdkCallToolResult } from "@exaix-team/mcp-server";
import { McpToolName, McpTransportType } from "@exaix/mcp";
import { createMCPRequest, initMCPTest, initMCPTestWithoutPortal } from "@exaix/mcp/testing";
import {
  GOLDEN_FIXTURE_PATH,
  GOLDEN_FIXTURE_SEED_FILES,
  type IGoldenFixtureCapture,
  REPRESENTATIVE_TOOL_CALLS,
} from "./fixtures/golden_fixture_capture.ts";

Deno.test("MCP Server: initializes with stdio transport", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    assertEquals(ctx.server.getTransport(), McpTransportType.STDIO);
    assertEquals(ctx.server.getServerName(), "exaix");
    assertExists(ctx.server.getVersion());
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: starts successfully", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    assertEquals(ctx.server.isRunning(), true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: handles initialize request", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    });

    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as { protocolVersion: string; serverInfo: { name: string; version: string } };
    assertEquals(result.protocolVersion, "2024-11-05");
    assertExists(result.serverInfo);
    assertEquals(result.serverInfo.name, "exaix");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: handles tools/list request", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("tools/list", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.result);
    const result = response.result as { tools: Array<{ name: string; description: string }> };
    assertExists(result.tools);
    assertEquals(Array.isArray(result.tools), true);

    assertEquals(result.tools.length, Object.values(McpToolName).length);
    const toolNames = result.tools.map((t: { name: string }) => t.name);
    assert(toolNames.includes(McpToolName.READ_FILE));
    assert(toolNames.includes(McpToolName.WRITE_FILE));
    assert(toolNames.includes(McpToolName.LIST_DIRECTORY));
    assert(toolNames.includes(McpToolName.GIT_CREATE_BRANCH));
    assert(toolNames.includes(McpToolName.GIT_COMMIT));
    assert(toolNames.includes(McpToolName.GIT_STATUS));
    assert(toolNames.includes(McpToolName.GIT_LOG));
    assert(toolNames.includes(McpToolName.GIT_WORKTREE));
    assert(toolNames.includes(McpToolName.CREATE_REQUEST));
    assert(toolNames.includes(McpToolName.LIST_PLANS));
    assert(toolNames.includes(McpToolName.APPROVE_PLAN));
    assert(toolNames.includes(McpToolName.QUERY_JOURNAL));
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: logs startup to IActivity Journal", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify mcp.server.started logged
    const logs = ctx.db.instance.prepare(
      "SELECT * FROM activity WHERE action_type = ?",
    ).all("mcp.server.started");

    assertEquals(logs.length, 1);
    const log = logs[0] as { payload: string };
    const payload = JSON.parse(log.payload);
    assertEquals(payload.transport, McpTransportType.STDIO);
    assertEquals(payload.server_name, "exaix");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: stops gracefully", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    assertEquals(ctx.server.isRunning(), true);

    await ctx.server.stop();
    assertEquals(ctx.server.isRunning(), false);

    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify mcp.server.stopped logged
    const logs = ctx.db.instance.prepare(
      "SELECT * FROM activity WHERE action_type = ?",
    ).all("mcp.server.stopped");

    assertEquals(logs.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: rejects invalid JSON-RPC request", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const response = await ctx.server.handleRequest({
      // Missing jsonrpc field
      id: 1,
      method: "initialize",
      params: {},
    } as never);

    assertExists(response.error);
    assertEquals(response.error.code, -32600); // Invalid Request
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: rejects unknown method", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createMCPRequest("unknown/method", {});
    const response = await ctx.server.handleRequest(request);

    assertExists(response.error);
    assertEquals(response.error.code, -32601); // Method not found
  } finally {
    await ctx.cleanup();
  }
});
Deno.test("MCP Server: classifyError handles Zod validation errors", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    // Create a mock Zod error with a constructor function named 'ZodError'
    // (zod v4 exposes validation details on `issues`)
    const zodError = {
      issues: [
        { path: ["portal"], message: "Required" },
        { path: ["path"], message: "Invalid format" },
      ],
      constructor: function ZodError() {},
    };

    // Access private method via type assertion
    const result = ctx.server.classifyError(zodError);

    assertEquals(result.type, "validation_error");
    assertEquals(result.code, -32602);
    assertEquals(result.message, "Invalid tool arguments");
    assertExists(result.data);
    const validationErrors = result.data.validation_errors;
    assert(Array.isArray(validationErrors));
    assertEquals(validationErrors.length, 2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: classifyError handles path traversal errors", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const error = new Error("Path traversal detected: ../secret.txt resolves to /etc/passwd, outside allowed roots");

    const result = ctx.server.classifyError(error);

    assertEquals(result.type, "security_error");
    assertEquals(result.code, -32602);
    assertEquals(result.message, "Access denied: Invalid path");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: classifyError handles not found errors", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const error = new Error("File not found: nonexistent.txt");

    const result = ctx.server.classifyError(error);

    assertEquals(result.type, "not_found_error");
    assertEquals(result.code, -32602);
    assertEquals(result.message, "Resource not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: classifyError handles permission errors", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const error = new Error("Permission denied: EACCES");

    const result = ctx.server.classifyError(error);

    assertEquals(result.type, "permission_error");
    assertEquals(result.code, -32603);
    assertEquals(result.message, "Permission denied");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: classifyError handles timeout errors", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const error = new Error("Operation timed out after 30 seconds");

    const result = ctx.server.classifyError(error);

    assertEquals(result.type, "timeout_error");
    assertEquals(result.code, -32603);
    assertEquals(result.message, "Operation timed out");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: classifyError handles generic errors", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const error = new Error("Some unexpected error occurred");

    const result = ctx.server.classifyError(error);

    assertEquals(result.type, "internal_error");
    assertEquals(result.code, -32603);
    assertEquals(result.message, "Some unexpected error occurred");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("MCP Server: classifyError handles non-Error objects", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const error = "String error message";

    const result = ctx.server.classifyError(error);

    assertEquals(result.type, "internal_error");
    assertEquals(result.code, -32603);
    assertEquals(result.message, "Internal server error");
  } finally {
    await ctx.cleanup();
  }
});

// serveStdio + McpServer — official-SDK dispatch parity

Deno.test(
  "[MCPServer SDK] serveStdio-served tools/list, resources/list, prompts/list, and representative tools/call responses match Step 1's golden fixture exactly",
  async () => {
    // Uses the low-level `client.request(..., z.unknown())` escape hatch, not
    // `listTools()`/`callTool()`: those validate against the SDK's strict content-block union
    // and would reject Exaix's proprietary `exaix_structured_data` type even though the server emits it correctly.
    const checkedIn = JSON.parse(await Deno.readTextFile(GOLDEN_FIXTURE_PATH)) as IGoldenFixtureCapture;
    const ctx = await initMCPTest({ initGit: true, fileContent: GOLDEN_FIXTURE_SEED_FILES });
    try {
      const sdkServer = ctx.server.buildSdkServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "golden-fixture-parity-client", version: "1.0.0" });
      await Promise.all([sdkServer.server.connect(serverTransport), client.connect(clientTransport)]);

      const toolsList = await client.request({ method: "tools/list", params: {} }, z.unknown());
      assertEquals(
        JSON.parse(JSON.stringify(toolsList)),
        checkedIn.toolsList.result,
        "tools/list must match Step 1's golden fixture exactly",
      );

      const resourcesList = await client.request({ method: "resources/list", params: {} }, z.unknown());
      assertEquals(
        JSON.parse(JSON.stringify(resourcesList)),
        checkedIn.resourcesList.result,
        "resources/list must match Step 1's golden fixture exactly",
      );

      const promptsList = await client.request({ method: "prompts/list", params: {} }, z.unknown());
      assertEquals(
        JSON.parse(JSON.stringify(promptsList)),
        checkedIn.promptsList.result,
        "prompts/list must match Step 1's golden fixture exactly",
      );

      for (const category of ["READ", "WRITE", "GIT", "META", "DOMAIN"] as const) {
        const spec = REPRESENTATIVE_TOOL_CALLS.find((c) => c.category === category);
        assertExists(spec, `representative call spec for category '${category}' must exist`);
        const callResult = await client.request(
          { method: "tools/call", params: { name: spec.toolName, arguments: spec.args } },
          z.unknown(),
        );
        // The checked-in fixture froze the pre-migration shape (proprietary `exaix_structured_data`
        // blocks inline in `content`); the SDK rejects that server-side, so `buildSdkServer` adapts it
        // into `structuredContent` instead — apply the same adapter to the fixture's expected value.
        const expected = toSdkCallToolResult(checkedIn.representativeToolCalls[category].result);
        assertEquals(
          JSON.parse(JSON.stringify(callResult)),
          JSON.parse(JSON.stringify(expected)),
          `representative tools/call for category '${category}' must match Step 1's golden fixture ` +
            "(adapted for the SDK's structuredContent mechanism where applicable)",
        );
      }

      await client.close();
    } finally {
      await ctx.cleanup();
    }
  },
);

Deno.test("[MCPServer] initialize negotiates the real current protocol version, not a hardcoded literal", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const sdkServer = ctx.server.buildSdkServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "protocol-version-client", version: "1.0.0" });
    await Promise.all([sdkServer.server.connect(serverTransport), client.connect(clientTransport)]);

    const negotiated = client.getNegotiatedProtocolVersion();
    assertExists(negotiated, "the SDK must negotiate a real protocol version during initialize");
    assert(
      negotiated !== "2024-11-05",
      `expected a current, SDK-negotiated protocol version, not the old hardcoded literal "2024-11-05" — got "${negotiated}"`,
    );

    await client.close();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[MCPServer] exaix/tools/result_schema round-trips through the official custom-method handler", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const sdkServer = ctx.server.buildSdkServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "result-schema-client", version: "1.0.0" });
    await Promise.all([sdkServer.server.connect(serverTransport), client.connect(clientTransport)]);

    const descriptor = await client.request(
      { method: "exaix/tools/result_schema", params: { tool: McpToolName.READ_FILE } },
      z.unknown(),
    );
    assertExists(descriptor, "exaix/tools/result_schema must return a descriptor for a known tool");

    await client.close();
  } finally {
    await ctx.cleanup();
  }
});

// Streamable HTTP transport — real-wire golden-fixture parity

Deno.test(
  "[MCPServer HTTP] tools/list and tools/call over real Streamable HTTP match the golden fixture",
  async () => {
    // Uses the low-level `client.request(..., z.unknown())` escape hatch for the same
    // reason as the InMemoryTransport parity test above: the typed convenience methods
    // reject Exaix's proprietary `exaix_structured_data` content type client-side.
    const checkedIn = JSON.parse(await Deno.readTextFile(GOLDEN_FIXTURE_PATH)) as IGoldenFixtureCapture;
    const ctx = await initMCPTest({ initGit: true, fileContent: GOLDEN_FIXTURE_SEED_FILES });
    const httpServer = Deno.serve({ port: 0, hostname: "localhost" }, ctx.server.buildHttpFetch());
    try {
      const addr = httpServer.addr;
      if (addr.transport !== "tcp") {
        throw new Error(`expected a tcp listener, got transport: ${addr.transport}`);
      }

      const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${addr.port}/`));
      const client = new Client({ name: "golden-fixture-http-parity-client", version: "1.0.0" });
      await client.connect(transport);

      const toolsList = await client.request({ method: "tools/list", params: {} }, z.unknown());
      assertEquals(
        JSON.parse(JSON.stringify(toolsList)),
        checkedIn.toolsList.result,
        "tools/list over real Streamable HTTP must match Step 1's golden fixture exactly",
      );

      for (const category of ["READ", "WRITE", "GIT", "META", "DOMAIN"] as const) {
        const spec = REPRESENTATIVE_TOOL_CALLS.find((c) => c.category === category);
        assertExists(spec, `representative call spec for category '${category}' must exist`);
        const callResult = await client.request(
          { method: "tools/call", params: { name: spec.toolName, arguments: spec.args } },
          z.unknown(),
        );
        // Apply the same structuredContent adapter as the InMemoryTransport parity test —
        // the wire shape is identical over real HTTP, only the transport framing differs.
        const expected = toSdkCallToolResult(checkedIn.representativeToolCalls[category].result);
        assertEquals(
          JSON.parse(JSON.stringify(callResult)),
          JSON.parse(JSON.stringify(expected)),
          `representative tools/call for category '${category}' over real Streamable HTTP must match ` +
            "Step 1's golden fixture (adapted for the SDK's structuredContent mechanism where applicable)",
        );
      }

      await client.close();
    } finally {
      await httpServer.shutdown();
      await ctx.cleanup();
    }
  },
);
