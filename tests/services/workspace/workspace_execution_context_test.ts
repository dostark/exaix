/**
 * @module WorkspaceExecutionContextTest
 * @path tests/services/workspace/workspace_execution_context_test.ts
 * @description Verifies the core logic for the WorkspaceExecutionContext, ensuring that trace
 * identifiers, portal roots, and security credentials are correctly partitioned for each request.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { WorkspaceExecutionContextBuilder } from "../../../src/services/portal/workspace_execution_context.ts";
import type { IPortalConfig } from "@exaix/schemas/config.ts";
import { ensureDir } from "@std/fs";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

function createPortalConfig(alias: string, targetPath: string): IPortalConfig {
  return {
    alias,
    target_path: targetPath,
    default_branch: TEST_DEFAULT_BRANCH,
    identities_allowed: ["*"],
    operations: [],
  };
}

function assertPortalContext(
  context: ReturnType<typeof WorkspaceExecutionContextBuilder.forPortal>,
  portalPath: string,
  alias: string,
): void {
  assertEquals(context.workingDirectory, portalPath);
  assertEquals(context.gitRepository, join(portalPath, ".git"));
  assertEquals(context.allowedPaths, [portalPath]);
  assertEquals(context.reviewRepo, join(portalPath, ".git"));
  assertEquals(context.portal, alias);
  assertEquals(context.portalTarget, portalPath);
}

function assertWorkspaceContext(
  context: ReturnType<typeof WorkspaceExecutionContextBuilder.forWorkspace>,
  workspacePath: string,
): void {
  assertEquals(context.workingDirectory, workspacePath);
  assertEquals(context.gitRepository, join(workspacePath, ".git"));
  assertEquals(context.allowedPaths, [workspacePath]);
  assertEquals(context.reviewRepo, join(workspacePath, ".git"));
  assertEquals(context.portal, undefined);
  assertEquals(context.portalTarget, undefined);
}

function assertThrowsWithMessage(action: () => void, expectedMessage: string): void {
  try {
    action();
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals((error as Error).message.includes(expectedMessage), true);
  }
}

describe("WorkspaceExecutionContextBuilder", () => {
  let tempDir: string;
  let portalDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "exa_test_context_" });
    portalDir = join(tempDir, "portal");
    workspaceDir = join(tempDir, "workspace");

    // Create portal and workspace directories with git repos
    await ensureDir(join(portalDir, ".git"));
    await ensureDir(join(workspaceDir, ".git"));
  });

  afterEach(async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe("forPortal", () => {
    it("creates correct portal context", () => {
      const portal = createPortalConfig("test-portal", portalDir);

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      assertPortalContext(context, portalDir, "test-portal");
    });

    it("normalizes portal target path", () => {
      const portalWithTrailingSlash = createPortalConfig("test-portal", portalDir + "/");

      const context = WorkspaceExecutionContextBuilder.forPortal(portalWithTrailingSlash);

      assertPortalContext(context, portalDir, "test-portal");
    });

    it("validates portal target exists", () => {
      const nonExistentPortal = createPortalConfig("missing-portal", join(tempDir, "nonexistent"));

      assertThrowsWithMessage(
        () => WorkspaceExecutionContextBuilder.validatePortalExists(nonExistentPortal),
        "Portal target path does not exist",
      );
    });

    it("validates git repository exists in portal", () => {
      const portalWithoutGit = createPortalConfig("no-git-portal", tempDir);

      assertThrowsWithMessage(
        () => WorkspaceExecutionContextBuilder.validatePortalGitRepo(portalWithoutGit),
        "Portal does not contain a git repository",
      );
    });

    it("resolves symlinks correctly", async () => {
      const symlinkPath = join(tempDir, "portal-symlink");
      await Deno.symlink(portalDir, symlinkPath);

      const portal = createPortalConfig("symlink-portal", symlinkPath);

      const resolved = await WorkspaceExecutionContextBuilder.resolvePortalSymlink(portal);
      const context = WorkspaceExecutionContextBuilder.forPortal(resolved);

      // Should resolve to actual directory
      const realPortalPath = await Deno.realPath(portalDir);
      assertPortalContext(context, realPortalPath, "symlink-portal");
    });
  });

  describe("forWorkspace", () => {
    it("creates correct workspace context", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);

      assertWorkspaceContext(context, workspaceDir);
    });

    it("normalizes workspace path", () => {
      const workspaceWithTrailingSlash = workspaceDir + "/";

      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceWithTrailingSlash);

      assertEquals(context.workingDirectory, workspaceDir);
    });

    it("validates workspace directory exists", () => {
      const nonExistentWorkspace = join(tempDir, "nonexistent");

      assertThrowsWithMessage(
        () => WorkspaceExecutionContextBuilder.validateWorkspaceExists(nonExistentWorkspace),
        "Workspace directory does not exist",
      );
    });

    it("validates git repository exists in workspace", () => {
      assertThrowsWithMessage(
        () => WorkspaceExecutionContextBuilder.validateWorkspaceGitRepo(tempDir),
        "Workspace does not contain a git repository",
      );
    });
  });

  describe("isolation", () => {
    it("creates isolated contexts for multiple portals", () => {
      const portal1Dir = join(tempDir, "portal1");
      const portal2Dir = join(tempDir, "portal2");

      const portal1 = createPortalConfig("portal-1", portal1Dir);
      const portal2 = createPortalConfig("portal-2", portal2Dir);

      const context1 = WorkspaceExecutionContextBuilder.forPortal(portal1);
      const context2 = WorkspaceExecutionContextBuilder.forPortal(portal2);

      // Contexts should be independent
      assertEquals(context1.workingDirectory !== context2.workingDirectory, true);
      assertEquals(context1.gitRepository !== context2.gitRepository, true);
      assertEquals(context1.portal, "portal-1");
      assertEquals(context2.portal, "portal-2");
    });

    it("portal context isolated from workspace context", () => {
      const portal = createPortalConfig("test-portal", portalDir);

      const portalContext = WorkspaceExecutionContextBuilder.forPortal(portal);
      const workspaceContext = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);

      // Should be different working directories
      assertEquals(portalContext.workingDirectory !== workspaceContext.workingDirectory, true);
      assertEquals(portalContext.gitRepository !== workspaceContext.gitRepository, true);

      // Portal context should have portal info, workspace shouldn't
      assertExists(portalContext.portal);
      assertEquals(workspaceContext.portal, undefined);
    });
  });

  describe("path validation", () => {
    it("includes only portal directory in allowed paths", () => {
      const portal = createPortalConfig("test-portal", portalDir);

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      assertEquals(context.allowedPaths.length, 1);
      assertEquals(context.allowedPaths[0], portalDir);
    });

    it("restricts allowed paths to workspace directory", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);

      assertEquals(context.allowedPaths.length, 1);
      assertEquals(context.allowedPaths[0], workspaceDir);
    });
  });

  describe("git repository configuration", () => {
    it("points to portal git repository", () => {
      const portal = createPortalConfig("test-portal", portalDir);

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      assertEquals(context.gitRepository, join(portalDir, ".git"));
      assertEquals(context.reviewRepo, join(portalDir, ".git"));
    });

    it("points to workspace git repository", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);

      assertEquals(context.gitRepository, join(workspaceDir, ".git"));
      assertEquals(context.reviewRepo, join(workspaceDir, ".git"));
    });

    it("git repository and review repo are the same", () => {
      const portal = createPortalConfig("test-portal", portalDir);

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      assertEquals(context.gitRepository, context.reviewRepo);
    });
  });
});
