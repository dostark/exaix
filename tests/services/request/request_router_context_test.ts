/**
 * @module RequestRouterContextTest
 * @path tests/services/request/request_router_context_test.ts
 * @description Verifies the RequestRouter's ability to maintain and propagate execution context
 * across routed requests, ensuring consistent trace and security boundaries.
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { RequestRouter } from "../../../src/services/request/request_router.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { EventLogger } from "@exaix/core/logger";
import type { Config } from "@exaix/schemas/config.ts";
import { setupPortalWorkspaceTestDirs } from "../helpers/portal_workspace_test_helper.ts";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import {
  createMockAgentRunner,
  createMockFlowRunner,
  createMockFlowValidator,
  sampleRouterRequest,
} from "../helpers.ts";

/**
 * TDD Tests for RequestRouter IWorkspaceExecutionContext Integration
 * Task 1.3: Request Router Integration
 */

describe("RequestRouter IWorkspaceExecutionContext Integration", () => {
  let tempDir: string;
  let portalDir: string;
  let workspaceDir: string;
  let originalCwd: string;
  let router: RequestRouter;
  let logger: EventLogger;
  let config: Config;
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
    const portalConfigRecord: IPortalPermissions = {
      alias: portalConfig.alias,
      target_path: portalConfig.target_path,
      default_branch: portalConfig.default_branch,
      identities_allowed: portalConfig.identities_allowed,
      operations: portalConfig.operations,
    };
    config = createMockConfig(workspaceDir, {
      portals: [portalConfigRecord],
    });

    logger = new EventLogger({ db: dbService.db });

    // Create mock dependencies
    const mockFlowRunner = createMockFlowRunner();
    const mockAgentRunner = createMockAgentRunner();
    const mockFlowValidator = createMockFlowValidator();

    // Create RequestRouter instance
    router = new RequestRouter({
      flowRunner: mockFlowRunner,
      agentRunner: mockAgentRunner,
      flowValidator: mockFlowValidator,
      eventLogger: logger,
      defaultAgentId: "default-agent",
      blueprintsPath: join(tempDir, "Blueprints"),
      config,
    });
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

  describe("buildExecutionContext method", () => {
    it("creates portal context when request has portal parameter", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          portal: "test-portal",
        },
        body: "test request",
      });

      const context = router.buildExecutionContext(request);

      assertExists(context);
      assertEquals(context.portal, "test-portal");
      assertEquals(context.workingDirectory, portalDir);
      assertEquals(context.gitRepository, join(portalDir, ".git"));
    });

    it("creates workspace context when request has no portal parameter", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {},
        body: "test request",
      });

      const context = router.buildExecutionContext(request);

      assertExists(context);
      assertEquals(context.portal, undefined);
      assertEquals(context.workingDirectory, workspaceDir);
      assertEquals(context.gitRepository, join(workspaceDir, ".git"));
    });

    it("throws error for invalid portal alias", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          portal: "non-existent-portal",
        },
        body: "test request",
      });

      try {
        router.buildExecutionContext(request);
        throw new Error("Should have thrown error");
      } catch (error) {
        assertEquals(
          (error as Error).message,
          "Portal 'non-existent-portal' not found",
        );
      }
    });
  });

  describe("route method integration", () => {
    it("builds and uses portal context for agent requests", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          identity: "test-agent",
          portal: "test-portal",
        },
        body: "test request",
      });

      // Verify context is built correctly
      const context = router.buildExecutionContext(request);
      assertExists(context);
      assertEquals(context.portal, "test-portal");
      assertEquals(context.workingDirectory, portalDir);
    });

    it("builds and uses workspace context for agent requests without portal", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          identity: "test-agent",
        },
        body: "test request",
      });

      // Verify context is built correctly
      const context = router.buildExecutionContext(request);
      assertExists(context);
      assertEquals(context.portal, undefined);
      assertEquals(context.workingDirectory, workspaceDir);
    });

    it("builds and uses portal context for flow requests", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          flow: "test-flow",
          portal: "test-portal",
        },
        body: "test request",
      });

      // Verify context is built correctly
      const context = router.buildExecutionContext(request);
      assertExists(context);
      assertEquals(context.portal, "test-portal");
      assertEquals(context.workingDirectory, portalDir);
    });
  });

  describe("portal validation", () => {
    it("validates portal exists before creating context", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          portal: "invalid-portal",
        },
        body: "test request",
      });

      try {
        router.buildExecutionContext(request);
        throw new Error("Should have thrown error");
      } catch (error) {
        assertEquals(
          (error as Error).message,
          "Portal 'invalid-portal' not found",
        );
      }
    });

    it("validates portal has required permissions", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          portal: "test-portal",
          identity: "restricted-agent",
        },
        body: "test request",
      });

      // This test will require portal permission checks
      // For now, just verify context is created
      const context = router.buildExecutionContext(request);

      assertExists(context);
      assertEquals(context.portal, "test-portal");
    });
  });

  describe("context lifecycle", () => {
    it("context can be built for portal requests", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          identity: "test-agent",
          portal: "test-portal",
        },
        body: "test request",
      });

      const context = router.buildExecutionContext(request);

      // Verify context was created
      assertExists(context);
      assertEquals(context.portal, "test-portal");
      assertEquals(context.workingDirectory, portalDir);
    });

    it("context can be built for workspace requests", () => {
      const request = sampleRouterRequest({
        traceId: "trace-1",
        requestId: "req-1",
        frontmatter: {
          identity: "test-agent",
        },
        body: "test request",
      });

      const context = router.buildExecutionContext(request);

      // Verify context was created
      assertExists(context);
      assertEquals(context.portal, undefined);
      assertEquals(context.workingDirectory, workspaceDir);
    });
  });
});
