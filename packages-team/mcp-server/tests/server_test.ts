/**
 * @module MCPServerTest
 * @path packages-team/mcp-server/tests/server_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Suite for the Exaix Model Context Protocol (MCP) server, verifying
 * initialization routines, transport layer integrity (Stdio/SSE), and core session management.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { McpToolName, McpTransportType } from "@exaix/mcp";
import { createMCPRequest, initMCPTestWithoutPortal } from "@exaix/mcp/testing";

/**
 * Tests for  MCP Server Implementation
 *
 * Success Criteria (Phase 1 - Foundation):
 * - MCP server starts with stdio transport
 * - Server exposes metadata (name, version)
 * - Server handles initialize handshake
 * - Server gracefully stops
 * - All operations logged to IActivity Journal
 */

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
    const zodError = {
      errors: [
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
