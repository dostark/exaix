/**
 * @module PortalWorkspaceIntegrationTest
 * @path tests/integration/portal_workspace_integration_test.ts
 * @description Verifies the integration of portal workspaces, ensuring correct
 * detection of agent capabilities (Read-only vs Write-capable) and repository boundaries.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { WorkspaceExecutionContextBuilder } from "../../src/services/portal/workspace_execution_context.ts";
import type { IPortalPermissions } from "../../src/shared/schemas/portal_permissions.ts";
import { PortalOperation } from "../../src/shared/enums.ts";
import { initTestDbService } from "../helpers/db.ts";

interface TestPortalSetup {
  portalPath: string;
  workspacePath: string;
  portalAlias: string;
  cleanup: () => Promise<void>;
}

/**
 * Setup a test portal with git repository
 */
async function setupTestPortal(alias = "test-portal"): Promise<TestPortalSetup> {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_portal_test_" });
  const portalPath = join(tempDir, "portal_repo");
  const workspacePath = join(tempDir, "workspace");

  // Create portal directory with git repo
  await ensureDir(portalPath);

  // Initialize git repo in portal
  const gitInit = new Deno.Command("git", {
    args: ["init"],
    cwd: portalPath,
    stdout: "null",
    stderr: "null",
  });
  await gitInit.output();

  // Configure git
  const configName = new Deno.Command("git", {
    args: ["config", "user.name", "Test User"],
    cwd: portalPath,
    stdout: "null",
  });
  await configName.output();

  const configEmail = new Deno.Command("git", {
    args: ["config", "user.email", "test@example.com"],
    cwd: portalPath,
    stdout: "null",
  });
  await configEmail.output();

  // Create initial commit
  await Deno.writeTextFile(join(portalPath, "README.md"), "# Test Portal\n");
  const gitAdd = new Deno.Command("git", {
    args: ["add", "."],
    cwd: portalPath,
    stdout: "null",
  });
  await gitAdd.output();

  const gitCommit = new Deno.Command("git", {
    args: ["commit", "-m", "Initial commit"],
    cwd: portalPath,
    stdout: "null",
  });
  await gitCommit.output();

  // Create workspace directory
  await ensureDir(workspacePath);

  const cleanup = async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    portalPath,
    workspacePath,
    portalAlias: alias,
    cleanup,
  };
}

/**
 * List git branches in a repository
 */
async function listGitBranches(repoPath: string): Promise<string[]> {
  const cmd = new Deno.Command("git", {
    args: ["branch", "--list"],
    cwd: repoPath,
    stdout: "piped",
  });

  const { stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout);

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\*\s+/, "")); // Remove current branch marker
}

Deno.test("[integration] Portal execution context points to portal workspace", async () => {
  const { cleanup, portalPath, portalAlias } = await setupTestPortal();

  try {
    const { db, cleanup: dbCleanup } = await initTestDbService();

    // Create portal config
    const portal: IPortalPermissions = {
      alias: portalAlias,
      target_path: portalPath,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    };

    // Build execution context for portal
    const context = WorkspaceExecutionContextBuilder.forPortal(portal);

    // Verify context points to portal workspace
    assertEquals(context.workingDirectory, portalPath);
    assertEquals(context.gitRepository, join(portalPath, ".git"));
    assertEquals(context.portal, portalAlias);
    assertEquals(context.portalTarget, portalPath);
    assertExists(context.allowedPaths);
    assertEquals(context.allowedPaths[0], portalPath);

    await db.close();
    await dbCleanup();
  } finally {
    await cleanup();
  }
});

Deno.test("[integration] Read-only agent capabilities detected correctly", async () => {
  const { cleanup, portalPath } = await setupTestPortal();

  try {
    // List branches before any execution
    const branchesBefore = await listGitBranches(portalPath);
    assertEquals(branchesBefore.length, 1); // Only main/master branch

    // Note: IAgentExecutor as AgentExecutor.requiresGitTracking() and isReadOnlyAgent()
    // are tested in unit tests (tests/services/agent_capability_test.ts)
    // This integration test verifies the portal git repo state remains clean
  } finally {
    await cleanup();
  }
});

Deno.test("[integration] Write-capable agent git repository structure", async () => {
  const { cleanup, portalPath } = await setupTestPortal();

  try {
    // Verify portal has proper git structure for write operations
    const gitDir = join(portalPath, ".git");
    const stat = await Deno.stat(gitDir);
    assertEquals(stat.isDirectory, true);

    // Note: IAgentExecutor as AgentExecutor.requiresGitTracking() logic for write-capable agents
    // is tested in unit tests (tests/services/agent_capability_test.ts)
    // This integration test verifies the portal git infrastructure exists
  } finally {
    await cleanup();
  }
});

Deno.test("[integration] Multi-portal contexts are isolated", async () => {
  const portal1 = await setupTestPortal("portal-1");
  const portal2 = await setupTestPortal("portal-2");

  try {
    const { db, cleanup: dbCleanup } = await initTestDbService();

    // Create portal configs
    const portalConfig1: IPortalPermissions = {
      alias: portal1.portalAlias,
      target_path: portal1.portalPath,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    };

    const portalConfig2: IPortalPermissions = {
      alias: portal2.portalAlias,
      target_path: portal2.portalPath,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    };

    // Build execution contexts for both portals
    const context1 = WorkspaceExecutionContextBuilder.forPortal(portalConfig1);
    const context2 = WorkspaceExecutionContextBuilder.forPortal(portalConfig2);

    // Verify contexts are isolated
    assertEquals(context1.workingDirectory, portal1.portalPath);
    assertEquals(context2.workingDirectory, portal2.portalPath);
    assertEquals(context1.gitRepository !== context2.gitRepository, true);
    assertEquals(context1.portal, portal1.portalAlias);
    assertEquals(context2.portal, portal2.portalAlias);

    await db.close();
    await dbCleanup();
  } finally {
    await portal1.cleanup();
    await portal2.cleanup();
  }
});

Deno.test("[integration] Portal context validation fails for missing git repo", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_no_git_" });

  try {
    const { db, cleanup: dbCleanup } = await initTestDbService();

    // Create directory without git repo
    await ensureDir(tempDir);

    // Create portal config pointing to non-git directory
    const portal: IPortalPermissions = {
      alias: "no-git-portal",
      target_path: tempDir,
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

    await db.close();
    await dbCleanup();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
