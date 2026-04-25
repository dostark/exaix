/**
 * @module SearchFilesToolTest
 * @path tests/mcp/handlers/search_files_tool_test.ts
 * @description Unit tests for the SearchFilesTool MCP tool.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { SearchFilesTool } from "../../../src/mcp/handlers/search_files_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import type { IToolRegistry, IToolResult } from "../../../src/shared/interfaces/i_tool_registry.ts";
import type { JSONValue } from "../../../src/shared/types/json.ts";

class MockToolRegistry implements IToolRegistry {
  private result: IToolResult = { success: true };

  setResult(result: IToolResult) {
    this.result = result;
  }

  getTools() {
    return [];
  }

  execute(_tool: string, _params: Record<string, JSONValue>): Promise<IToolResult> {
    return Promise.resolve(this.result);
  }
}

Deno.test("SearchFilesTool: searches for files using glob pattern", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.READ],
    fileContent: {
      "src/main.ts": "content",
      "src/utils.ts": "content",
      "README.md": "content",
    },
  });

  try {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({
      success: true,
      data: { files: ["/tmp/mcp-test/TestPortal/src/main.ts", "/tmp/mcp-test/TestPortal/src/utils.ts"] },
    });

    const context = createStubContext({
      config: createStubConfig(env.config),
      toolRegistry: mockRegistry,
    });

    const handler = new SearchFilesTool(context, new PortalPermissionsService([env.permissions]));
    const result = await handler.execute({
      portal: "TestPortal",
      pattern: "**/*.ts",
      identity_id: "test-agent",
    });

    assertEquals(result.content[0].type, "text");
    assertStringIncludes(result.content[0].text, "Found 2 files");
  } finally {
    await env.cleanup();
  }
});

Deno.test("SearchFilesTool: throws error if search fails in ToolRegistry", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.READ],
  });

  try {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: false, error: "Disk error" });

    const context = createStubContext({
      config: createStubConfig(env.config),
      toolRegistry: mockRegistry,
    });

    const handler = new SearchFilesTool(context, new PortalPermissionsService([env.permissions]));
    try {
      await handler.execute({
        portal: "TestPortal",
        pattern: "**/*.ts",
        identity_id: "test-agent",
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Disk error");
    }
  } finally {
    await env.cleanup();
  }
});

Deno.test("SearchFilesTool: throws error if ToolRegistry is missing from context", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.READ],
  });

  try {
    const context = createStubContext({
      config: createStubConfig(env.config),
      toolRegistry: undefined, // Missing
    });

    const handler = new SearchFilesTool(context, new PortalPermissionsService([env.permissions]));
    try {
      await handler.execute({
        portal: "TestPortal",
        pattern: "**/*.ts",
        identity_id: "test-agent",
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertStringIncludes((error as Error).message, "ToolRegistry not available");
    }
  } finally {
    await env.cleanup();
  }
});

Deno.test("SearchFilesTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new SearchFilesTool(context);
  const def = handler.getToolDefinition();
  const required = Array.isArray(def.inputSchema.required)
    ? def.inputSchema.required.filter((value): value is string => typeof value === "string")
    : [];

  assertEquals(def.name, McpToolName.SEARCH_FILES);
  assertEquals(required.includes("portal"), true);
  assertEquals(required.includes("pattern"), true);
});
