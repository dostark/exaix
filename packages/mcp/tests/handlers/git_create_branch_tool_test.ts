/**
 * @module GitCreateBranchToolTest
 * @path packages/mcp/tests/handlers/git_create_branch_tool_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for the GitCreateBranchTool MCP tool.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { GitCreateBranchTool } from "@exaix-team/mcp-server";
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

function createHandler(env: Parameters<typeof createToolContext>[0]): GitCreateBranchTool {
  return new GitCreateBranchTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("GitCreateBranchTool: creates branch successfully", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  }, async (env) => {
    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      branch: "feat/new-test-branch",
      identity_id: "test-agent",
    });

    const res = result as MCPToolResponse & { isError?: boolean; content: { text: string }[] };
    assertEquals(res.isError, undefined);
    assertStringIncludes(getFirstTextContent(res), "created and checked out successfully");
  });
});

Deno.test("GitCreateBranchTool: returns isError when branch already exists", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  }, async (env) => {
    const handler = createHandler(env);

    // Make an initial commit so branches have an actual commit to point to
    await Deno.writeTextFile(join(env.portalPath, "test.txt"), "hello");
    await SafeSubprocess.run("git", ["add", "test.txt"], { cwd: env.portalPath });
    await SafeSubprocess.run("git", ["commit", "-m", "init"], { cwd: env.portalPath });

    // Create the branch first
    await handler.execute({
      portal: "TestPortal",
      branch: "feat/existing-branch",
      identity_id: "test-agent",
    });

    // Try to create it again — should return isError:true
    const result = await handler.execute({
      portal: "TestPortal",
      branch: "feat/existing-branch",
      identity_id: "test-agent",
    });
    assertEquals(result.isError, true);
  });
});

Deno.test("GitCreateBranchTool: returns isError when access is denied", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ], // No GIT permission
    initGit: true,
  }, async (env) => {
    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      branch: "feat/new-test-branch",
      identity_id: "test-agent",
    });
    assertEquals(result.isError, true);
    assertStringIncludes(getFirstTextContent(result), "not permitted");
  });
});

Deno.test("GitCreateBranchTool: getToolDefinition returns correct definition", () => {
  const handler = new GitCreateBranchTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), "git_create_branch", ["portal", "branch"]);
});
