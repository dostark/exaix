/**
 * @module CreateDirectoryToolTest
 * @path tests/mcp/handlers/create_directory_tool_test.ts
 * @description Unit tests for the CreateDirectoryTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { CreateDirectoryTool } from "../../../src/mcp/handlers/create_directory_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "../../../src/shared/enums.ts";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal_permissions.ts";
import { join } from "@std/path";

Deno.test("CreateDirectoryTool: creates a single directory", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });

    const handler = new CreateDirectoryTool(context, new PortalPermissionsService([env.permissions]));
    await handler.execute({
      portal: "TestPortal",
      path: "src/newdir",
      identity_id: "test-agent",
    });

    const stat = await Deno.stat(join(env.portalPath, "src/newdir"));
    assertEquals(stat.isDirectory, true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("CreateDirectoryTool: creates nested directories recursively", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });

    const handler = new CreateDirectoryTool(context, new PortalPermissionsService([env.permissions]));
    await handler.execute({
      portal: "TestPortal",
      path: "src/a/b/c",
      identity_id: "test-agent",
    });

    const stat = await Deno.stat(join(env.portalPath, "src/a/b/c"));
    assertEquals(stat.isDirectory, true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("CreateDirectoryTool: is idempotent — succeeds if directory already exists", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    await Deno.mkdir(join(env.portalPath, "src/existing"), { recursive: true });

    const handler = new CreateDirectoryTool(context, new PortalPermissionsService([env.permissions]));
    const result = await handler.execute({
      portal: "TestPortal",
      path: "src/existing",
      identity_id: "test-agent",
    });

    assertEquals(result !== undefined, true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("CreateDirectoryTool: blocks path traversal", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });

    const handler = new CreateDirectoryTool(context, new PortalPermissionsService([env.permissions]));
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          path: "../../outside",
          identity_id: "test-agent",
        }),
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("CreateDirectoryTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new CreateDirectoryTool(context);
  const def = handler.getToolDefinition();

  assertEquals(def.name, "create_directory");
  assertEquals(Array.isArray(def.inputSchema.required), true);
  assertStringIncludes(def.inputSchema.required.join(), "portal");
  assertStringIncludes(def.inputSchema.required.join(), "path");
});
