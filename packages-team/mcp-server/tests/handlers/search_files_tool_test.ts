/**
 * @module SearchFilesToolTest
 * @path packages-team/mcp-server/tests/handlers/search_files_tool_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for the SearchFilesTool MCP tool.
 */
import { assertEquals } from "@std/assert";
import { SearchFilesTool } from "@exaix-team/mcp-server";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "@exaix/mcp/testing";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { IToolRegistry, IToolResult } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";

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

  getBaseDir(): string {
    return "/tmp";
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

Deno.test("SearchFilesTool: searches for files and returns structured data content", async () => {
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
      data: {
        files: ["/tmp/mcp-perm-test-abc/TestPortal/src/main.ts", "/tmp/mcp-perm-test-abc/TestPortal/src/utils.ts"],
      },
    });

    const handler = createHandler(env, mockRegistry);
    const result = await handler.execute({
      portal: "TestPortal",
      pattern: "**/*.ts",
      agent_role: "test-agent",
    });

    assertEquals(result.content[0].type, "exaix_structured_data");
    assertEquals(result.isError, undefined);
    type ISearchBlock = { type: "exaix_structured_data"; data: { files: string[] } };
    const block = result.content[0] as ISearchBlock;
    assertEquals(block.data.files.length, 2);
  });
});

Deno.test("SearchFilesTool: search failure returns isError:true response", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: false, error: "Disk error" });

    const handler = createHandler(env, mockRegistry);
    const result = await handler.execute({
      portal: "TestPortal",
      pattern: "**/*.ts",
      agent_role: "test-agent",
    });

    assertEquals(result.isError, true);
    assertEquals(result.content[0].type, "text");
    assertEquals((result.content[0] as { type: "text"; text: string }).text, "Disk error");
  });
});

Deno.test("SearchFilesTool: missing ToolRegistry returns isError:true response", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
  }, async (env) => {
    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      pattern: "**/*.ts",
      agent_role: "test-agent",
    });

    assertEquals(result.isError, true);
    assertEquals(result.content[0].type, "text");
  });
});

Deno.test("SearchFilesTool: getToolDefinition returns correct definition", () => {
  const handler = new SearchFilesTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), McpToolName.SEARCH_FILES, ["portal", "pattern"]);
});
