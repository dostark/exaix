/**
 * @module MCPServerPromptsTest
 * @path tests/mcp/server_prompts_test.ts
 * @description Verifies the MCP server's prompt handling logic, ensuring correct
 * listing of available templates and successful fulfillment of 'prompts/get' requests.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MemoryBankSource } from "../../src/shared/enums.ts";
import { initSimpleMCPServer } from "./helpers/test_setup.ts";

type IMCPServerTestContext = Awaited<ReturnType<typeof initSimpleMCPServer>>;

// ============================================================================
// Prompts List Tests
// ============================================================================

// Helper for MCP server tests
async function withMCPServer(
  fn: (ctx: Pick<IMCPServerTestContext, "server" | "db">) => Promise<void>,
) {
  const { server, db, cleanup } = await initSimpleMCPServer();
  try {
    await fn({ server, db });
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Prompts List Tests
// ============================================================================

Deno.test("MCP Server: handles prompts/list request", async () => {
  await withMCPServer(async ({ server }) => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/list",
      params: {},
    });

    assertExists(response.result);
    const result = response.result as { prompts: Array<{ name: string; description: string }> };

    assertEquals(result.prompts.length, 3);

    const promptNames = result.prompts.map((p) => p.name);
    assertEquals(promptNames.includes("execute_plan"), true);
    assertEquals(promptNames.includes("create_review"), true);
    assertEquals(promptNames.includes("commit_message"), true);
  });
});

Deno.test("MCP Server: prompts/list includes descriptions and arguments", async () => {
  await withMCPServer(async ({ server }) => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/list",
      params: {},
    });

    assertExists(response.result);
    const result = response.result as {
      prompts: Array<{
        name: string;
        description: string;
        arguments?: Array<{ name: string; description: string; required: boolean }>;
      }>;
    };

    const executePlan = result.prompts.find((p) => p.name === "execute_plan");
    assertExists(executePlan);
    assertExists(executePlan.description);
    assertExists(executePlan.arguments);
    assertEquals(executePlan.arguments!.length, 2);
  });
});

// ============================================================================
// Prompts Get Tests
// ============================================================================

Deno.test("MCP Server: handles prompts/get for execute_plan", async () => {
  await withMCPServer(async ({ server }) => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: {
        name: "execute_plan",
        arguments: { plan_id: "test-plan-123", portal: "MyApp" },
      },
    });

    assertExists(response.result);
    const result = response.result as {
      description: string;
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };

    assertExists(result.description);
    assertStringIncludes(result.description, "test-plan-123");
    assertStringIncludes(result.description, "MyApp");
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].role, MemoryBankSource.USER);
    assertStringIncludes(result.messages[0].content.text, "test-plan-123");
    assertStringIncludes(result.messages[0].content.text, "MyApp");
  });
});

Deno.test("MCP Server: handles prompts/get for create_review", async () => {
  await withMCPServer(async ({ server }) => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: {
        name: "create_review",
        arguments: { portal: "MyApp", description: "Add authentication", trace_id: "trace-789" },
      },
    });

    assertExists(response.result);
    const result = response.result as {
      description: string;
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };

    assertStringIncludes(result.description, "Add authentication");
    assertStringIncludes(result.messages[0].content.text, "MyApp");
    assertStringIncludes(result.messages[0].content.text, "Add authentication");
    assertStringIncludes(result.messages[0].content.text, "trace-789");
  });
});

Deno.test("MCP Server: prompts/get rejects unknown prompt", async () => {
  await withMCPServer(async ({ server }) => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: { name: "unknown_prompt", arguments: {} },
    });

    assertExists(response.error);
    assertEquals(response.error.code, -32602);
    assertStringIncludes(response.error.message, "not found");
  });
});

Deno.test("MCP Server: prompts/get logs to IActivity Journal", async () => {
  await withMCPServer(async ({ server, db }) => {
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: {
        name: "execute_plan",
        arguments: { plan_id: "log-test-plan", portal: "TestPortal" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logs = db.instance.prepare("SELECT * FROM activity WHERE action_type = ?")
      .all("mcp.prompts.execute_plan");
    assertEquals(logs.length, 1);

    const log = logs[0] as { target: string };
    assertEquals(log.target, "log-test-plan");
  });
});
