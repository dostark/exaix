/**
 * @module PatchFileToolTest
 * @path tests/mcp/handlers/patch_file_tool_test.ts
 * @description Unit tests for the PatchFileTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PatchFileTool } from "../../../src/mcp/handlers/patch_file_tool.ts";
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

function createHandler(env: Parameters<typeof createToolContext>[0]): PatchFileTool {
  return new PatchFileTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("PatchFileTool: replaces exactly one occurrence", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "function foo() {\n  return 1;\n}\n");

    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      path: targetPath,
      search: "function foo()",
      replace: "function bar()",
      identity_id: "test-agent",
    });

    const res = result as MCPToolResponse & { isError?: boolean; content: { text: string }[] };
    assertEquals(res.isError, undefined);
    assertStringIncludes(getFirstTextContent(res), "success");

    const content = await Deno.readTextFile(join(env.portalPath, targetPath));
    assertStringIncludes(content, "function bar()");
    assertEquals(content.includes("function foo()"), false);
  });
});

Deno.test("PatchFileTool: throws when search string not found", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "function foo() {}");

    const handler = createHandler(env);
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          path: targetPath,
          search: "function notHere()",
          replace: "function bar()",
          identity_id: "test-agent",
        }),
      Error,
      "search string not found",
    );
  });
});

Deno.test("PatchFileTool: throws when search string matches multiple times", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "foo()\nfoo()\n");

    const handler = createHandler(env);
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          path: targetPath,
          search: "foo()",
          replace: "bar()",
          identity_id: "test-agent",
        }),
      Error,
      "found 2 times",
    );
  });
});

Deno.test("PatchFileTool: supports empty replace string (deletion)", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "// TODO: remove this\nconst x = 1;\n");

    const handler = createHandler(env);
    await handler.execute({
      portal: "TestPortal",
      path: targetPath,
      search: "// TODO: remove this\n",
      replace: "",
      identity_id: "test-agent",
    });

    const content = await Deno.readTextFile(join(env.portalPath, targetPath));
    assertEquals(content, "const x = 1;\n");
  });
});

Deno.test("PatchFileTool: getToolDefinition returns correct definition", () => {
  const handler = new PatchFileTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), "patch_file", ["portal", "path", "search", "replace"]);
});
