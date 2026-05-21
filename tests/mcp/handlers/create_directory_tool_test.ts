/**
 * @module CreateDirectoryToolTest
 * @path tests/mcp/handlers/create_directory_tool_test.ts
 * @description Unit tests for the CreateDirectoryTool MCP tool.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { CreateDirectoryTool } from "@exaix/mcp/server";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { join } from "@std/path";

function createHandler(env: Parameters<typeof createToolContext>[0]): CreateDirectoryTool {
  return new CreateDirectoryTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("CreateDirectoryTool: creates a single directory", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const handler = createHandler(env);
    await handler.execute({
      portal: "TestPortal",
      path: "src/newdir",
      identity_id: "test-agent",
    });

    const stat = await Deno.stat(join(env.portalPath, "src/newdir"));
    assertEquals(stat.isDirectory, true);
  });
});

Deno.test("CreateDirectoryTool: creates nested directories recursively", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const handler = createHandler(env);
    await handler.execute({
      portal: "TestPortal",
      path: "src/a/b/c",
      identity_id: "test-agent",
    });

    const stat = await Deno.stat(join(env.portalPath, "src/a/b/c"));
    assertEquals(stat.isDirectory, true);
  });
});

Deno.test("CreateDirectoryTool: is idempotent — succeeds if directory already exists", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    await Deno.mkdir(join(env.portalPath, "src/existing"), { recursive: true });

    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      path: "src/existing",
      identity_id: "test-agent",
    });

    assertEquals(result !== undefined, true);
  });
});

Deno.test("CreateDirectoryTool: blocks path traversal", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const handler = createHandler(env);
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          path: "../../outside",
          identity_id: "test-agent",
        }),
    );
  });
});

Deno.test("CreateDirectoryTool: getToolDefinition returns correct definition", () => {
  const handler = new CreateDirectoryTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), McpToolName.CREATE_DIRECTORY, ["portal", "path"]);
});
