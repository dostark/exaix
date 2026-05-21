/**
 * @module MoveFileToolTest
 * @path tests/mcp/handlers/move_file_tool_test.ts
 * @description Unit tests for the MoveFileTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { MoveFileTool } from "@exaix/mcp/server";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  getFirstTextContent,
  withToolPermissionTest,
} from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { join } from "@std/path";

function createHandler(env: Parameters<typeof createToolContext>[0]): MoveFileTool {
  return new MoveFileTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("MoveFileTool: moves a file to a new path", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/old.ts"), "const x = 1;");

    const handler = createHandler(env);
    await handler.execute({
      portal: "TestPortal",
      from: "src/old.ts",
      to: "src/new.ts",
      identity_id: "test-agent",
    });

    await assertRejects(() => Deno.stat(join(env.portalPath, "src/old.ts")));
    const content = await Deno.readTextFile(join(env.portalPath, "src/new.ts"));
    assertEquals(content, "const x = 1;");
  });
});

Deno.test("MoveFileTool: returns isError if destination already exists", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/a.ts"), "a");
    await Deno.writeTextFile(join(env.portalPath, "src/b.ts"), "b");

    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      from: "src/a.ts",
      to: "src/b.ts",
      identity_id: "test-agent",
    });
    assertEquals(result.isError, true);
    assertStringIncludes(getFirstTextContent(result), "Destination already exists");
  });
});

Deno.test("MoveFileTool: creates destination parent directories", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/a.ts"), "a");

    const handler = createHandler(env);
    await handler.execute({
      portal: "TestPortal",
      from: "src/a.ts",
      to: "src/subdir/nested/a.ts",
      identity_id: "test-agent",
    });

    const content = await Deno.readTextFile(join(env.portalPath, "src/subdir/nested/a.ts"));
    assertEquals(content, "a");
  });
});

Deno.test("MoveFileTool: returns isError on path traversal in destination", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, "src/a.ts"), "a");

    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      from: "src/a.ts",
      to: "../../outside.ts",
      identity_id: "test-agent",
    });
    assertEquals(result.isError, true);
  });
});

Deno.test("MoveFileTool: getToolDefinition returns correct definition", () => {
  const handler = new MoveFileTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), "move_file", ["portal", "from", "to"]);
});
