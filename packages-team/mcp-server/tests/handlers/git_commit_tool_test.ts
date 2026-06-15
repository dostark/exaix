/**
 * @module GitCommitToolTest
 * @path packages-team/mcp-server/tests/handlers/git_commit_tool_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for the GitCommitTool MCP tool.
 */
import { assertEquals, assertMatch } from "@std/assert";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { GitCommitTool } from "@exaix-team/mcp-server";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  getFirstTextContent,
  withToolPermissionTest,
} from "@exaix/mcp/testing";
import { PortalOperation } from "@exaix/core";
import { join } from "@std/path";
import { SafeSubprocess } from "@exaix/core";

function createHandler(env: Parameters<typeof createToolContext>[0]): GitCommitTool {
  return new GitCommitTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("GitCommitTool: commits changes successfully", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  }, async (env) => {
    // Create uncommitted change
    await Deno.writeTextFile(join(env.portalPath, "test_file.txt"), "some content");

    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      message: "Test commit message",
      identity_id: "test-agent",
    });

    const res = result as MCPToolResponse & { isError?: boolean; content: { text: string }[] };
    assertEquals(res.isError, undefined);
    assertMatch(getFirstTextContent(res), /^[0-9a-f]{40}$/);
  });
});

Deno.test("GitCommitTool: commits specific files successfully", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  }, async (env) => {
    // Create uncommitted changes
    await Deno.writeTextFile(join(env.portalPath, "test_file1.txt"), "some content 1");
    // Explicitly add first file
    await SafeSubprocess.run("git", ["add", "test_file1.txt"], { cwd: env.portalPath });

    await Deno.writeTextFile(join(env.portalPath, "test_file2.txt"), "some content 2");

    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      message: "Test commit message",
      files: ["test_file2.txt"],
      identity_id: "test-agent",
    });

    const res = result as MCPToolResponse & { isError?: boolean; content: { text: string }[] };
    assertEquals(res.isError, undefined);
    assertMatch(getFirstTextContent(res), /^[0-9a-f]{40}$/);
  });
});

Deno.test("GitCommitTool: returns error when git commit fails", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  }, async (env) => {
    const handler = createHandler(env);
    const response = await handler.execute({
      portal: "TestPortal",
      message: "Test commit message",
      identity_id: "test-agent",
    });

    assertEquals(response.isError, true);
    assertEquals(response.content[0].type, "text");
  });
});

Deno.test("GitCommitTool: returns error when access is denied", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ], // No GIT permission
    initGit: true,
  }, async (env) => {
    const handler = createHandler(env);
    const response = await handler.execute({
      portal: "TestPortal",
      message: "Test commit message",
      identity_id: "test-agent",
    });

    assertEquals(response.isError, true);
    assertEquals(response.content[0].type, "text");
  });
});

Deno.test("GitCommitTool: getToolDefinition returns correct definition", () => {
  const handler = new GitCommitTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), "git_commit", ["portal", "message"]);
});
