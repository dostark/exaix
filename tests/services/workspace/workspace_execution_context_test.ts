/**
 * @module WorkspaceExecutionContextTest
 * @path tests/services/workspace_execution_context_test.ts
 * @description Verifies the core logic for the WorkspaceExecutionContext, ensuring that trace
 * identifiers, portal roots, and security credentials are correctly partitioned for each request.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { WorkspaceExecutionContextBuilder } from "../../../src/services/workspace_execution_context.ts";
import type { IPortalConfig } from "../../../src/shared/schemas/config.ts";
import { ensureDir } from "@std/fs";

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
      const portal: IPortalConfig = {
        alias: "test-portal",
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      assertEquals(context.workingDirectory, portalDir);
      assertEquals(context.gitRepository, join(portalDir, ".git"));
      assertEquals(context.allowedPaths, [portalDir]);
      assertEquals(context.reviewRepo, join(portalDir, ".git"));
      assertEquals(context.portal, "test-portal");
      assertEquals(context.portalTarget, portalDir);
    });

    it("normalizes portal target path", () => {
      const portalWithTrailingSlash: IPortalConfig = {
        alias: "test-portal",
        target_path: portalDir + "/",
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portalWithTrailingSlash);

      assertEquals(context.workingDirectory, portalDir);
      assertEquals(context.gitRepository, join(portalDir, ".git"));
    });

    it("validates portal target exists", () => {
      const nonExistentPortal: IPortalConfig = {
        alias: "missing-portal",
        target_path: join(tempDir, "nonexistent"),
      };

      try {
        WorkspaceExecutionContextBuilder.validatePortalExists(nonExistentPortal);
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals((error as Error).message.includes("Portal target path does not exist"), true);
      }
    });

    it("validates git repository exists in portal", () => {
      const portalWithoutGit: IPortalConfig = {
        alias: "no-git-portal",
        target_path: tempDir, // temp dir exists but has no .git
      };

      try {
        WorkspaceExecutionContextBuilder.validatePortalGitRepo(portalWithoutGit);
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals((error as Error).message.includes("Portal does not contain a git repository"), true);
      }
    });

    it("resolves symlinks correctly", async () => {
      const symlinkPath = join(tempDir, "portal-symlink");
      await Deno.symlink(portalDir, symlinkPath);

      const portal: IPortalConfig = {
        alias: "symlink-portal",
        target_path: symlinkPath,
      };

      const resolved = await WorkspaceExecutionContextBuilder.resolvePortalSymlink(portal);
      const context = WorkspaceExecutionContextBuilder.forPortal(resolved);

      // Should resolve to actual directory
      const realPortalPath = await Deno.realPath(portalDir);
      assertEquals(context.workingDirectory, realPortalPath);
      assertEquals(context.gitRepository, join(realPortalPath, ".git"));
    });
  });

  describe("forWorkspace", () => {
    it("creates correct workspace context", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);

      assertEquals(context.workingDirectory, workspaceDir);
      assertEquals(context.gitRepository, join(workspaceDir, ".git"));
      assertEquals(context.allowedPaths, [workspaceDir]);
      assertEquals(context.reviewRepo, join(workspaceDir, ".git"));
      assertEquals(context.portal, undefined);
      assertEquals(context.portalTarget, undefined);
    });

    it("normalizes workspace path", () => {
      const workspaceWithTrailingSlash = workspaceDir + "/";

      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceWithTrailingSlash);

      assertEquals(context.workingDirectory, workspaceDir);
    });

    it("validates workspace directory exists", () => {
      const nonExistentWorkspace = join(tempDir, "nonexistent");

      try {
        WorkspaceExecutionContextBuilder.validateWorkspaceExists(nonExistentWorkspace);
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals((error as Error).message.includes("Workspace directory does not exist"), true);
      }
    });

    it("validates git repository exists in workspace", () => {
      try {
        WorkspaceExecutionContextBuilder.validateWorkspaceGitRepo(tempDir);
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals((error as Error).message.includes("Workspace does not contain a git repository"), true);
      }
    });
  });

  describe("isolation", () => {
    it("creates isolated contexts for multiple portals", () => {
      const portal1Dir = join(tempDir, "portal1");
      const portal2Dir = join(tempDir, "portal2");

      const portal1: IPortalConfig = {
        alias: "portal-1",
        target_path: portal1Dir,
      };

      const portal2: IPortalConfig = {
        alias: "portal-2",
        target_path: portal2Dir,
      };

      const context1 = WorkspaceExecutionContextBuilder.forPortal(portal1);
      const context2 = WorkspaceExecutionContextBuilder.forPortal(portal2);

      // Contexts should be independent
      assertEquals(context1.workingDirectory !== context2.workingDirectory, true);
      assertEquals(context1.gitRepository !== context2.gitRepository, true);
      assertEquals(context1.portal, "portal-1");
      assertEquals(context2.portal, "portal-2");
    });

    it("portal context isolated from workspace context", () => {
      const portal: IPortalConfig = {
        alias: "test-portal",
        target_path: portalDir,
      };

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
      const portal: IPortalConfig = {
        alias: "test-portal",
        target_path: portalDir,
      };

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
      const portal: IPortalConfig = {
        alias: "test-portal",
        target_path: portalDir,
      };

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
      const portal: IPortalConfig = {
        alias: "test-portal",
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      assertEquals(context.gitRepository, context.reviewRepo);
    });
  });
});
