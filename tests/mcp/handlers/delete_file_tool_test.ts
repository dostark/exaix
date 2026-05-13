/**
 * @module DeleteFileToolTest
 * @path tests/mcp/handlers/delete_file_tool_test.ts
 * @description Unit tests for the DeleteFileTool MCP tool.
 */
import { assertRejects } from "@std/assert";
import { DeleteFileTool } from "../../../src/mcp/handlers/delete_file_tool.ts";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { join } from "@std/path";

function createHandler(env: Parameters<typeof createToolContext>[0]): DeleteFileTool {
  return new DeleteFileTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("DeleteFileTool: deletes an existing file", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/old.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "// old content");

    const handler = createHandler(env);
    await handler.execute({
      portal: "TestPortal",
      path: targetPath,
      identity_id: "test-agent",
    });

    await assertRejects(() => Deno.stat(join(env.portalPath, targetPath)));
  });
});

Deno.test("DeleteFileTool: throws when file not found", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/ghost.ts";

    const handler = createHandler(env);
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          path: targetPath,
          identity_id: "test-agent",
        }),
      Error,
      "File not found",
    );
  });
});

Deno.test("DeleteFileTool: refuses to delete a directory", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/somedir";
    await Deno.mkdir(join(env.portalPath, targetPath), { recursive: true });

    const handler = createHandler(env);
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          path: targetPath,
          identity_id: "test-agent",
        }),
      Error,
      "is a directory",
    );
  });
});

Deno.test("DeleteFileTool: getToolDefinition returns correct definition", () => {
  const handler = new DeleteFileTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), "delete_file", ["portal", "path"]);
});
