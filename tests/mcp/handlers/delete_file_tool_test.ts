/**
 * @module DeleteFileToolTest
 * @path tests/mcp/handlers/delete_file_tool_test.ts
 * @description Unit tests for the DeleteFileTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { DeleteFileTool } from "../../../src/mcp/handlers/delete_file_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { join } from "@std/path";

Deno.test("DeleteFileTool: deletes an existing file", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/old.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "// old content");

    const handler = new DeleteFileTool(context, new PortalPermissionsService([env.permissions]));
    await handler.execute({
      portal: "TestPortal",
      path: targetPath,
      identity_id: "test-agent",
    });

    await assertRejects(() => Deno.stat(join(env.portalPath, targetPath)));
  } finally {
    await env.cleanup();
  }
});

Deno.test("DeleteFileTool: throws when file not found", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/ghost.ts";

    const handler = new DeleteFileTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("DeleteFileTool: refuses to delete a directory", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/somedir";
    await Deno.mkdir(join(env.portalPath, targetPath), { recursive: true });

    const handler = new DeleteFileTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("DeleteFileTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new DeleteFileTool(context);
  const def = handler.getToolDefinition();
  const required = Array.isArray(def.inputSchema.required)
    ? def.inputSchema.required.filter((value): value is string => typeof value === "string")
    : [];

  assertEquals(def.name, "delete_file");
  assertEquals(Array.isArray(def.inputSchema.required), true);
  assertStringIncludes(required.join(), "portal");
  assertStringIncludes(required.join(), "path");
});
