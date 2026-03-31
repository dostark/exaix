/**
 * @module AgentExecutorContextAPITest
 * @path tests/services/agent_executor_context_api_test.ts
 * @description Verifies the Context API within the AgentExecutor, ensuring sandboxed tools
 * can securely access and modify approved execution state.
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { AgentExecutor } from "../../../src/services/agent/agent_executor.ts";
import { WorkspaceExecutionContextBuilder } from "../../../src/services/portal/workspace_execution_context.ts";
import type { IPortalPermissions } from "../../../src/shared/schemas/portal_permissions.ts";
import { PortalOperation } from "../../../src/shared/enums.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { PathResolver } from "../../../src/services/portal/path_resolver.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { setupPortalWorkspaceTestDirs } from "../helpers/portal_workspace_test_helper.ts";

describe("AgentExecutor API with IWorkspaceExecutionContext", () => {
  let tempDir: string;
  let portalDir: string;
  let workspaceDir: string;
  let originalCwd: string;
  let executor: AgentExecutor;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    originalCwd = Deno.cwd();

    // Use test helpers for proper setup
    const dbService = await initTestDbService();
    tempDir = dbService.tempDir;
    cleanup = dbService.cleanup;

    const dirs = await setupPortalWorkspaceTestDirs(tempDir);
    portalDir = dirs.portalDir;
    workspaceDir = dirs.workspaceDir;
    const portalConfig = dirs.portalConfig;

    // Create mock config
    const config = createMockConfig(tempDir, {
      portals: [portalConfig],
    });

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([portalConfig]);

    executor = new AgentExecutor(
      config,
      dbService.db,
      logger,
      pathResolver,
      permissions,
    );
  });

  afterEach(async () => {
    try {
      Deno.chdir(originalCwd);
    } catch (_error) {
      // Ignore
    }

    if (cleanup) {
      await cleanup();
    }
  });

  describe("setExecutionContext method", () => {
    it("accepts IWorkspaceExecutionContext for portal", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      // This method should exist on AgentExecutor
      executor.setExecutionContext(context);

      // Verify context was stored
      const storedContext = executor.getExecutionContext();
      assertEquals(storedContext?.workingDirectory, portalDir);
      assertEquals(storedContext?.portal, "test-portal");
    });

    it("accepts IWorkspaceExecutionContext for workspace", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);

      executor.setExecutionContext(context);

      const storedContext = executor.getExecutionContext();
      assertEquals(storedContext?.workingDirectory, workspaceDir);
      assertEquals(storedContext?.portal, undefined);
    });

    it("changes working directory to context location", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);
      executor.setExecutionContext(context);

      // Working directory should have changed
      assertEquals(Deno.cwd(), portalDir);
    });

    it("restores original working directory when context cleared", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const originalDir = Deno.cwd();
      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      executor.setExecutionContext(context);
      assertEquals(Deno.cwd(), portalDir);

      // Clear context
      executor.clearExecutionContext();
      assertEquals(Deno.cwd(), originalDir);
    });
  });

  describe("getExecutionContext method", () => {
    it("returns undefined when no context set", () => {
      const context = executor.getExecutionContext();
      assertEquals(context, undefined);
    });

    it("returns current execution context", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);
      executor.setExecutionContext(context);

      const retrieved = executor.getExecutionContext();
      assertExists(retrieved);
      assertEquals(retrieved.workingDirectory, portalDir);
      assertEquals(retrieved.gitRepository, join(portalDir, ".git"));
      assertEquals(retrieved.portal, "test-portal");
    });
  });

  describe("clearExecutionContext method", () => {
    it("clears stored context", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);
      executor.setExecutionContext(context);

      assertExists(executor.getExecutionContext());

      executor.clearExecutionContext();
      assertEquals(executor.getExecutionContext(), undefined);
    });

    it("restores original directory", () => {
      const originalDir = Deno.cwd();

      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);
      executor.setExecutionContext(context);

      executor.clearExecutionContext();
      assertEquals(Deno.cwd(), originalDir);
    });
  });

  describe("withExecutionContext helper method", () => {
    it("executes function in portal context", async () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      let executedInCorrectDir = false;

      await executor.withExecutionContext(context, () => {
        if (Deno.cwd() === portalDir) {
          executedInCorrectDir = true;
        }
        return Promise.resolve();
      });

      assertEquals(executedInCorrectDir, true);
      // Should restore original directory after
      assertEquals(Deno.cwd(), originalCwd);
    });

    it("restores directory even if function throws", async () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      try {
        await executor.withExecutionContext(context, () => {
          throw new Error("Test error");
        });
      } catch (_error) {
        // Expected
      }

      // Should still restore original directory
      assertEquals(Deno.cwd(), originalCwd);
    });

    it("returns function result", async () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [
          PortalOperation.READ,
          PortalOperation.WRITE,
          PortalOperation.GIT,
        ],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);

      const result = await executor.withExecutionContext(context, () => {
        return "test-result";
      });

      assertEquals(result, "test-result");
    });
  });

  describe("getGitRepository method", () => {
    it("returns portal git repository when portal context set", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);
      executor.setExecutionContext(context);

      const gitRepo = executor.getGitRepository();
      assertEquals(gitRepo, join(portalDir, ".git"));
    });

    it("returns workspace git repository when workspace context set", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);
      executor.setExecutionContext(context);

      const gitRepo = executor.getGitRepository();
      assertEquals(gitRepo, join(workspaceDir, ".git"));
    });

    it("returns undefined when no context set", () => {
      const gitRepo = executor.getGitRepository();
      assertEquals(gitRepo, undefined);
    });
  });

  describe("getAllowedPaths method", () => {
    it("returns portal allowed paths when portal context set", () => {
      const portal: IPortalPermissions = {
        alias: "test-portal",
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        identities_allowed: ["*"],
        target_path: portalDir,
      };

      const context = WorkspaceExecutionContextBuilder.forPortal(portal);
      executor.setExecutionContext(context);

      const allowedPaths = executor.getAllowedPaths();
      assertExists(allowedPaths);
      assertEquals(allowedPaths.length, 1);
      assertEquals(allowedPaths[0], portalDir);
    });

    it("returns workspace allowed paths when workspace context set", () => {
      const context = WorkspaceExecutionContextBuilder.forWorkspace(workspaceDir);
      executor.setExecutionContext(context);

      const allowedPaths = executor.getAllowedPaths();
      assertExists(allowedPaths);
      assertEquals(allowedPaths.length, 1);
      assertEquals(allowedPaths[0], workspaceDir);
    });

    it("returns undefined when no context set", () => {
      const allowedPaths = executor.getAllowedPaths();
      assertEquals(allowedPaths, undefined);
    });
  });
});
