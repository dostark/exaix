/**
 * @module SearchFilesToolTest
 * @path tests/mcp/handlers/search_files_tool_test.ts
 * @description Unit tests for the SearchFilesTool MCP tool.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { SearchFilesTool } from "../../../src/mcp/handlers/search_files_tool.ts";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { IToolRegistry, IToolResult } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types/json.ts";

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

function createHandler(
  env: Parameters<typeof createToolContext>[0],
  toolRegistry?: IToolRegistry,
): SearchFilesTool {
  return new SearchFilesTool(
    createToolContext(env, { toolRegistry }),
    createPermissionsService(env),
  );
}

Deno.test("SearchFilesTool: searches for files using glob pattern", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
    fileContent: {
      "src/main.ts": "content",
      "src/utils.ts": "content",
      "README.md": "content",
    },
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({
      success: true,
      data: { files: ["/tmp/mcp-test/TestPortal/src/main.ts", "/tmp/mcp-test/TestPortal/src/utils.ts"] },
    });

    const handler = createHandler(env, mockRegistry);
    const result = await handler.execute({
      portal: "TestPortal",
      pattern: "**/*.ts",
      identity_id: "test-agent",
    });

    assertEquals(result.content[0].type, "text");
    assertStringIncludes(result.content[0].text, "Found 2 files");
  });
});

Deno.test("SearchFilesTool: throws error if search fails in ToolRegistry", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: false, error: "Disk error" });

    const handler = createHandler(env, mockRegistry);
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
  });
});

Deno.test("SearchFilesTool: throws error if ToolRegistry is missing from context", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
  }, async (env) => {
    const handler = createHandler(env);
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
  });
});

Deno.test("SearchFilesTool: getToolDefinition returns correct definition", () => {
  const handler = new SearchFilesTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), McpToolName.SEARCH_FILES, ["portal", "pattern"]);
});
