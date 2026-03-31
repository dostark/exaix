/**
 * @module GitCreateBranchToolTest
 * @path tests/mcp/handlers/git_create_branch_tool_test.ts
 * @description Unit tests for the GitCreateBranchTool MCP tool.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { MCPToolResponse } from "../../../src/shared/schemas/mcp.ts";
import { GitCreateBranchTool } from "../../../src/mcp/handlers/git_create_branch_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "../../../src/shared/enums.ts";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { join } from "@std/path";
import { SafeSubprocess } from "../../../src/helpers/subprocess.ts";

Deno.test("GitCreateBranchTool: creates branch successfully", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  });

  try {
    const context = createStubContext({
      config: createStubConfig(env.config),
    });

    const handler = new GitCreateBranchTool(context, new PortalPermissionsService([env.permissions]));
    const result = await handler.execute({
      portal: "TestPortal",
      branch: "feat/new-test-branch",
      identity_id: "test-agent",
    });

    const res = result as MCPToolResponse & { isError?: boolean; content: { text: string }[] };
    assertEquals(res.isError, undefined);
    assertStringIncludes(res.content[0].text, "created and checked out successfully");
  } finally {
    await env.cleanup();
  }
});

Deno.test("GitCreateBranchTool: returns error when branch already exists", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.GIT],
    initGit: true,
  });

  try {
    const context = createStubContext({
      config: createStubConfig(env.config),
    });

    const handler = new GitCreateBranchTool(context, new PortalPermissionsService([env.permissions]));

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
  } finally {
    await env.cleanup();
  }
});

Deno.test("GitCreateBranchTool: returns error when access is denied", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.READ], // No GIT permission
    initGit: true,
  });

  try {
    const context = createStubContext({
      config: createStubConfig(env.config),
    });

    const handler = new GitCreateBranchTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("GitCreateBranchTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new GitCreateBranchTool(context);
  const def = handler.getToolDefinition();

  assertEquals(def.name, "git_create_branch");
  assertEquals(Array.isArray(def.inputSchema.required), true);
  assertStringIncludes(def.inputSchema.required.join(), "portal");
  assertStringIncludes(def.inputSchema.required.join(), "branch");
});
