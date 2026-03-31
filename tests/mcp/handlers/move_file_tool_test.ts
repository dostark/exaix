/**
 * @module MoveFileToolTest
 * @path tests/mcp/handlers/move_file_tool_test.ts
 * @description Unit tests for the MoveFileTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { MoveFileTool } from "../../../src/mcp/handlers/move_file_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "../../../src/shared/enums.ts";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { join } from "@std/path";

Deno.test("MoveFileTool: moves a file to a new path", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/old.ts"), "const x = 1;");

    const handler = new MoveFileTool(context, new PortalPermissionsService([env.permissions]));
    await handler.execute({
      portal: "TestPortal",
      from: "src/old.ts",
      to: "src/new.ts",
      identity_id: "test-agent",
    });

    await assertRejects(() => Deno.stat(join(env.portalPath, "src/old.ts")));
    const content = await Deno.readTextFile(join(env.portalPath, "src/new.ts"));
    assertEquals(content, "const x = 1;");
  } finally {
    await env.cleanup();
  }
});

Deno.test("MoveFileTool: throws if destination already exists", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/a.ts"), "a");
    await Deno.writeTextFile(join(env.portalPath, "src/b.ts"), "b");

    const handler = new MoveFileTool(context, new PortalPermissionsService([env.permissions]));
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          from: "src/a.ts",
          to: "src/b.ts",
          identity_id: "test-agent",
        }),
      Error,
      "Destination already exists",
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("MoveFileTool: creates destination parent directories", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/a.ts"), "a");

    const handler = new MoveFileTool(context, new PortalPermissionsService([env.permissions]));
    await handler.execute({
      portal: "TestPortal",
      from: "src/a.ts",
      to: "src/subdir/nested/a.ts",
      identity_id: "test-agent",
    });

    const content = await Deno.readTextFile(join(env.portalPath, "src/subdir/nested/a.ts"));
    assertEquals(content, "a");
  } finally {
    await env.cleanup();
  }
});

Deno.test("MoveFileTool: blocks path traversal on destination", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/a.ts"), "a");

    const handler = new MoveFileTool(context, new PortalPermissionsService([env.permissions]));
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          from: "src/a.ts",
          to: "../../outside.ts",
          identity_id: "test-agent",
        }),
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("MoveFileTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new MoveFileTool(context);
  const def = handler.getToolDefinition();

  assertEquals(def.name, "move_file");
  assertEquals(Array.isArray(def.inputSchema.required), true);
  assertStringIncludes(def.inputSchema.required.join(), "portal");
  assertStringIncludes(def.inputSchema.required.join(), "from");
  assertStringIncludes(def.inputSchema.required.join(), "to");
});
