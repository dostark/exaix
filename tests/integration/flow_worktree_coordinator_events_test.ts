/**
 * @module FlowWorktreeCoordinatorEventsTest
 * @path tests/integration/flow_worktree_coordinator_events_test.ts
 * @description Phase 194 Step 9 (GAP-6 remediation) — proves the @visible-tagged
 * FlowWorktreeCoordinator's flow.worktree.created / flow.worktree.released events persist
 * through a real EventLogger and activity journal (not only createMockEventLogger()'s
 * in-memory capture), with the correct trace_id and {portalAlias, traceId} payload.
 * @architectural-layer Integration
 * @dependencies [@exaix/flow, @exaix/git, @exaix/core, @exaix/testing]
 * @related-files [packages/flow/src/flow_worktree_coordinator.ts, apps/daemon/tests/session_delegate_cycle_events_test.ts]
 */

import { assertEquals } from "@std/assert";
import { FlowWorktreeCoordinator } from "@exaix/flow";
import { GitService } from "@exaix/git";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import type { IGitServiceFactory } from "@exaix/core/types";

const PORTAL_ALIAS = "worktree-events-portal";

Deno.test({
  name:
    "[integration] FlowWorktreeCoordinator.resolve emits flow.worktree.created through a real EventLogger, persisted in the real activity journal with the correct trace_id and {portalAlias, traceId} payload",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, tempDir: systemRoot, cleanup: cleanupDb } = await initTestDbService();
    const portalDir = await Deno.makeTempDir({ prefix: "flow-worktree-events-portal-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });
      const config = createMockConfig(systemRoot, {
        portals: [{
          alias: PORTAL_ALIAS,
          target_path: portalDir,
          default_branch: TEST_DEFAULT_BRANCH,
          agents_allowed: ["*"],
          operations: [],
        }],
      });

      const logger = new EventLogger({ db });
      const gitServiceFactory: IGitServiceFactory = {
        createGitService: (repoPath: string, traceId: string) => new GitService({ config, traceId, repoPath }),
      };
      const coordinator = new FlowWorktreeCoordinator({ config, gitServiceFactory, logger });

      const traceId = crypto.randomUUID();
      await coordinator.resolve(PORTAL_ALIAS, traceId, TEST_DEFAULT_BRANCH);

      await db.waitForFlush();
      const events = await db.getActivitiesByTraceSafe(traceId);
      const created = events.find((event) => event.action_type === DomainEventType.FlowWorktreeCreated);
      if (!created) throw new Error("flow.worktree.created event was not journaled");
      assertEquals(created.trace_id, traceId);
      assertEquals(JSON.parse(created.payload ?? "{}"), { portalAlias: PORTAL_ALIAS, traceId });
    } finally {
      await cleanupDb();
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[integration] FlowWorktreeCoordinator.release emits flow.worktree.released through a real EventLogger, persisted with the correct trace_id",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, tempDir: systemRoot, cleanup: cleanupDb } = await initTestDbService();
    const portalDir = await Deno.makeTempDir({ prefix: "flow-worktree-events-portal-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });
      const config = createMockConfig(systemRoot, {
        portals: [{
          alias: PORTAL_ALIAS,
          target_path: portalDir,
          default_branch: TEST_DEFAULT_BRANCH,
          agents_allowed: ["*"],
          operations: [],
        }],
      });

      const logger = new EventLogger({ db });
      const gitServiceFactory: IGitServiceFactory = {
        createGitService: (repoPath: string, traceId: string) => new GitService({ config, traceId, repoPath }),
      };
      const coordinator = new FlowWorktreeCoordinator({ config, gitServiceFactory, logger });

      const traceId = crypto.randomUUID();
      await coordinator.resolve(PORTAL_ALIAS, traceId, TEST_DEFAULT_BRANCH);
      await coordinator.release(PORTAL_ALIAS, traceId);

      await db.waitForFlush();
      const events = await db.getActivitiesByTraceSafe(traceId);
      const released = events.find((event) => event.action_type === DomainEventType.FlowWorktreeReleased);
      if (!released) throw new Error("flow.worktree.released event was not journaled");
      assertEquals(released.trace_id, traceId);
      assertEquals(JSON.parse(released.payload ?? "{}"), { portalAlias: PORTAL_ALIAS, traceId });
    } finally {
      await cleanupDb();
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    }
  },
});
