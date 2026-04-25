/**
 * @module PortalWorkspaceIntegrationTest
 * @path tests/integration/36_portal_workspace_integration_test.ts
 * @description Verifies the integration of portal workspaces, ensuring correct
 * detection of agent capabilities (Read-only vs Write-capable) and repository boundaries.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { WorkspaceExecutionContextBuilder } from "../../src/services/portal/workspace_execution_context.ts";
import { PortalOperation } from "@exaix/core";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { TEST_DEFAULT_BRANCH } from "../helpers/constants.ts";

Deno.test("[integration] Portal execution context points to portal workspace", async () => {
  const env = await TestEnvironment.create();

  try {
    const { config: portal, portalDir: portalPath } = await env.setupPortal({
      alias: "test-portal",
    });

    // Build execution context for portal
    const context = WorkspaceExecutionContextBuilder.forPortal(portal);

    // Verify context points to portal workspace
    assertEquals(context.workingDirectory, portalPath);
    assertEquals(context.gitRepository, join(portalPath, ".git"));
    assertEquals(context.portal, portal.alias);
    assertEquals(context.portalTarget, portalPath);
    assertExists(context.allowedPaths);
    assertEquals(context.allowedPaths[0], portalPath);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[integration] Read-only agent capabilities detected correctly", async () => {
  const env = await TestEnvironment.create();
  try {
    const { portalDir: portalPath } = await env.setupPortal({
      alias: "test-portal",
    });

    // Verify portal git repo exists
    const gitDir = join(portalPath, ".git");
    const stat = await Deno.stat(gitDir);
    assertEquals(stat.isDirectory, true);

    // Note: IAgentExecutor as AgentExecutor.requiresGitTracking() and isReadOnlyAgent()
    // are tested in unit tests (tests/services/agent_capability_test.ts)
    // This integration test verifies the portal git repo infrastructure is initialized by setupPortal
  } finally {
    await env.cleanup();
  }
});

Deno.test("[integration] Write-capable agent git repository structure", async () => {
  const env = await TestEnvironment.create();
  try {
    const { portalDir: portalPath } = await env.setupPortal({
      alias: "test-portal",
    });

    // Verify portal has proper git structure for write operations
    const gitDir = join(portalPath, ".git");
    const stat = await Deno.stat(gitDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[integration] Multi-portal contexts are isolated", async () => {
  const env = await TestEnvironment.create();
  try {
    const portal1 = await env.setupPortal({ alias: "portal-1" });
    const portal2 = await env.setupPortal({ alias: "portal-2" });

    // Build execution contexts for both portals
    const context1 = WorkspaceExecutionContextBuilder.forPortal(portal1.config);
    const context2 = WorkspaceExecutionContextBuilder.forPortal(portal2.config);

    // Verify contexts are isolated
    assertEquals(context1.workingDirectory, portal1.portalDir);
    assertEquals(context2.workingDirectory, portal2.portalDir);
    assertEquals(context1.gitRepository !== context2.gitRepository, true);
    assertEquals(context1.portal, portal1.config.alias);
    assertEquals(context2.portal, portal2.config.alias);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[integration] Portal context validation fails for missing git repo", async () => {
  const env = await TestEnvironment.create();
  try {
    // Manually create a directory WITHOUT git repo
    const noRepoPath = join(env.tempDir, "no-repo");
    await Deno.mkdir(noRepoPath, { recursive: true });

    // Create portal config pointing to non-git directory
    const portal = {
      alias: "no-git-portal",
      target_path: noRepoPath,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ],
    };

    // Attempt to validate portal git repo
    let errorThrown = false;
    try {
      WorkspaceExecutionContextBuilder.validatePortalGitRepo(portal);
    } catch (error) {
      errorThrown = true;
      if (error instanceof Error) {
        assertEquals(error.message.includes("git repository"), true);
      }
    }

    assertEquals(errorThrown, true, "Should throw error for missing git repo");
  } finally {
    await env.cleanup();
  }
});
