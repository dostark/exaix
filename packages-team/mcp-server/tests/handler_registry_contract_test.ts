/**
 * @module HandlerRegistryContractTest
 * @path packages-team/mcp-server/tests/handler_registry_contract_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies that registry-delegating MCP handlers (run_command, search_files) use the canonical toolResultToMcpResponse conversion.
 */
import { assertEquals } from "@std/assert";
import { toolResultToMcpResponse } from "@exaix/mcp";
import { RunCommandTool } from "@exaix-team/mcp-server";
import { SearchFilesTool } from "@exaix-team/mcp-server";
import { createPermissionsService, createToolContext, withToolPermissionTest } from "@exaix/mcp/testing";
import { PortalOperation } from "@exaix/core";
import type { IToolRegistry, IToolResult } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";

class FixedResultRegistry implements IToolRegistry {
  private result: IToolResult;

  constructor(result: IToolResult) {
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

Deno.test("toolResultToMcpResponse: pass-through check — converter output structure is stable", () => {
  const input = { success: true, data: { output: "hello", exitCode: 0 } };
  const converted = toolResultToMcpResponse(input);

  assertEquals(converted.content[0].type, "exaix_structured_data");
  assertEquals(converted.isError, undefined);
});

Deno.test("RunCommandTool: response content matches toolResultToMcpResponse for successful execution", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const registryResult: IToolResult = { success: true, data: { output: "expected output\n", exitCode: 0 } };
    const handler = new RunCommandTool(
      createToolContext(env, { toolRegistry: new FixedResultRegistry(registryResult) }),
      createPermissionsService(env),
    );

    const handlerResponse = await handler.execute({
      portal: "TestPortal",
      command: "ls",
      args: [],
      agent_role: "test-agent",
    });

    const canonicalResponse = toolResultToMcpResponse(registryResult);

    assertEquals(handlerResponse.content.length, canonicalResponse.content.length);
    assertEquals(handlerResponse.content[0].type, canonicalResponse.content[0].type);
    assertEquals(handlerResponse.isError, canonicalResponse.isError);
  });
});

Deno.test("SearchFilesTool: response content matches toolResultToMcpResponse for successful search", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
  }, async (env) => {
    const registryResult: IToolResult = { success: true, data: { files: [] } };
    const handler = new SearchFilesTool(
      createToolContext(env, { toolRegistry: new FixedResultRegistry(registryResult) }),
      createPermissionsService(env),
    );

    const handlerResponse = await handler.execute({
      portal: "TestPortal",
      pattern: "**/*.ts",
      agent_role: "test-agent",
    });

    const canonicalResponse = toolResultToMcpResponse(registryResult);

    assertEquals(handlerResponse.content.length, canonicalResponse.content.length);
    assertEquals(handlerResponse.content[0].type, canonicalResponse.content[0].type);
    assertEquals(handlerResponse.isError, canonicalResponse.isError);
  });
});
