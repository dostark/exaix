/**
 * @module PatchFileToolTest
 * @path tests/mcp/handlers/patch_file_tool_test.ts
 * @description Unit tests for the PatchFileTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { MCPToolResponse } from "../../../src/shared/schemas/mcp.ts";
import { PatchFileTool } from "../../../src/mcp/handlers/patch_file_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "../../../src/shared/enums.ts";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal_permissions.ts";
import { join } from "@std/path";

Deno.test("PatchFileTool: replaces exactly one occurrence", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "function foo() {\n  return 1;\n}\n");

    const handler = new PatchFileTool(context, new PortalPermissionsService([env.permissions]));
    const result = await handler.execute({
      portal: "TestPortal",
      path: targetPath,
      search: "function foo()",
      replace: "function bar()",
      identity_id: "test-agent",
    });

    const res = result as MCPToolResponse & { isError?: boolean; content: { text: string }[] };
    assertEquals(res.isError, undefined);
    assertStringIncludes(res.content[0].text, "success");

    const content = await Deno.readTextFile(join(env.portalPath, targetPath));
    assertStringIncludes(content, "function bar()");
    assertEquals(content.includes("function foo()"), false);
  } finally {
    await env.cleanup();
  }
});

Deno.test("PatchFileTool: throws when search string not found", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "function foo() {}");

    const handler = new PatchFileTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("PatchFileTool: throws when search string matches multiple times", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "foo()\nfoo()\n");

    const handler = new PatchFileTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("PatchFileTool: supports empty replace string (deletion)", async () => {
  const env = await initToolPermissionTest({ operations: [PortalOperation.WRITE] });

  try {
    const context = createStubContext({ config: createStubConfig(env.config) });
    const targetPath = "src/main.ts";
    await Deno.mkdir(join(env.portalPath, "src"), { recursive: true });
    await Deno.writeTextFile(join(env.portalPath, targetPath), "// TODO: remove this\nconst x = 1;\n");

    const handler = new PatchFileTool(context, new PortalPermissionsService([env.permissions]));
    await handler.execute({
      portal: "TestPortal",
      path: targetPath,
      search: "// TODO: remove this\n",
      replace: "",
      identity_id: "test-agent",
    });

    const content = await Deno.readTextFile(join(env.portalPath, targetPath));
    assertEquals(content, "const x = 1;\n");
  } finally {
    await env.cleanup();
  }
});

Deno.test("PatchFileTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new PatchFileTool(context);
  const def = handler.getToolDefinition();

  assertEquals(def.name, "patch_file");
  assertEquals(Array.isArray(def.inputSchema.required), true);
  assertStringIncludes(def.inputSchema.required.join(), "portal");
  assertStringIncludes(def.inputSchema.required.join(), "path");
  assertStringIncludes(def.inputSchema.required.join(), "search");
  assertStringIncludes(def.inputSchema.required.join(), "replace");
});
