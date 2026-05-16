/**
 * @module GitCreateBranchToolTest
 * @path tests/mcp/handlers/git_create_branch_tool_test.ts
 * @description Unit tests for the GitCreateBranchTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { GitCreateBranchTool } from "../../../src/mcp/handlers/git_create_branch_tool.ts";
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
import { SafeSubprocess } from "../../../src/helpers/subprocess.ts";

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

Deno.test("GitCreateBranchTool: returns error when branch already exists", async () => {
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

    // Try to create it again
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          branch: "feat/existing-branch",
          identity_id: "test-agent",
        }),
      Error,
      "Failed to create branch: ",
    );
  });
});

Deno.test("GitCreateBranchTool: returns error when access is denied", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ], // No GIT permission
    initGit: true,
  }, async (env) => {
    const handler = createHandler(env);
    await assertRejects(
      () =>
        handler.execute({
          portal: "TestPortal",
          branch: "feat/new-test-branch",
          identity_id: "test-agent",
        }),
      Error,
      "Operation 'git' is not permitted",
    );
  });
});

Deno.test("GitCreateBranchTool: getToolDefinition returns correct definition", () => {
  const handler = new GitCreateBranchTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), "git_create_branch", ["portal", "branch"]);
});
