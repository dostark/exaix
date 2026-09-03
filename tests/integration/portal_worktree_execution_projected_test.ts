/**
 * @module PortalWorktreeExecutionIntegrationTest
 * @path tests/integration/portal_worktree_execution_projected_test.ts
 * @description Verifies the logic for concurrent worktree executions, ensuring that
 * multiple agent journeys in external portals do not conflict or orphan Git resources.
 */

import { assertEquals, assertExists, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { ExecutionLoop } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ReviewRegistry } from "@exaix/core/artifact";
import { ToolRegistry } from "@exaix/tool-runtime";
import { TestEnvironment } from "./helpers/test_environment.ts";
import {
  assertPointerPointsTo,
  gitStdout,
  listBranches,
  pathExists,
  setupWorktreePortalRepo,
  withSingleWorktreePortal,
} from "./helpers/worktree_portal_test_utils.ts";
import { ToolName } from "@exaix/core";

async function setupPortalWorktreeExecutionLoop(env: TestEnvironment) {
  const portalAlias = "worktree-portal";
  const portalTargetPath = join(env.tempDir, "portal-worktree-target");
  const targetBranch = "release_1.2";

  await setupWorktreePortalRepo(portalTargetPath, targetBranch);

  const config = withSingleWorktreePortal(env.config, portalAlias, portalTargetPath, "main");

  const logger = new EventLogger({ db: env.db });
  const reviewRegistry = new ReviewRegistry(env.db, logger);
  const loop = new ExecutionLoop({
    config,
    db: env.db,
    agentRole: "daemon",
    reviewRegistry,
    gitServiceFactory: {
      createGitService(repoPath: string, traceId: string) {
        return new GitService({ config, traceId, agentRole: "daemon", repoPath });
      },
    },
    toolRegistryFactory: {
      createToolRegistry(traceId: string, baseDir: string) {
        return new ToolRegistry({ config, traceId, agentRole: "daemon", baseDir });
      },
    },
  });

  return { portalAlias, portalTargetPath, targetBranch, loop };
}

Deno.test(
  "[e2e][regression] Phase 37.6: two worktree executions create isolated worktrees and preserve portal checkout",
  async () => {
    const env = await TestEnvironment.create();

    try {
      const { portalAlias, portalTargetPath, targetBranch, loop } = await setupPortalWorktreeExecutionLoop(env);

      const traceA = crypto.randomUUID();
      const requestA = `request-${traceA.substring(0, 8)}`;
      const planA = await env.createPlan(traceA, requestA, {
        status: "review",
        agentRole: "senior-coder",
        portal: portalAlias,
        targetBranch,
        actions: [
          {
            tool: ToolName.WRITE_FILE,
            params: {
              path: "src/worktree_A.ts",
              content: `export const A = ${JSON.stringify("A")};\n`,
            },
          },
        ],
      });

      const traceB = crypto.randomUUID();
      const requestB = `request-${traceB.substring(0, 8)}`;
      const planB = await env.createPlan(traceB, requestB, {
        status: "review",
        agentRole: "senior-coder",
        portal: portalAlias,
        targetBranch,
        actions: [
          {
            tool: ToolName.WRITE_FILE,
            params: {
              path: "src/worktree_B.ts",
              content: `export const B = ${JSON.stringify("B")};\n`,
            },
          },
        ],
      });

      const activeA = await env.approvePlan(planA);
      const activeB = await env.approvePlan(planB);

      // Sequential execution (still validates isolation without relying on concurrency).
      const resultA = await loop.processTask(activeA);
      const resultB = await loop.processTask(activeB);

      assertEquals(resultA.success, true);
      assertEquals(resultB.success, true);

      // Portal checkout should remain on main.
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), "main");

      // Both feature branches should exist.
      const branches = await listBranches(portalTargetPath);
      const branchA = branches.find((b: string) => b.startsWith(`feat/${requestA}-`));
      const branchB = branches.find((b: string) => b.startsWith(`feat/${requestB}-`));
      assertExists(branchA);
      assertExists(branchB);
      assertMatch(branchA, /^feat\/request-[0-9a-f]{8}-/);
      assertMatch(branchB, /^feat\/request-[0-9a-f]{8}-/);

      const wtA = join(env.tempDir, ".exa", "worktrees", portalAlias, traceA);
      const wtB = join(env.tempDir, ".exa", "worktrees", portalAlias, traceB);

      assertEquals(await pathExists(wtA), true);
      assertEquals(await pathExists(wtB), true);

      // Each worktree should only contain its own new file.
      assertEquals(await pathExists(join(wtA, "src", "worktree_A.ts")), true);
      assertEquals(await pathExists(join(wtA, "src", "worktree_B.ts")), false);
      assertEquals(await pathExists(join(wtB, "src", "worktree_B.ts")), true);
      assertEquals(await pathExists(join(wtB, "src", "worktree_A.ts")), false);

      // Portal checkout on main should not see either file.
      assertEquals(await pathExists(join(portalTargetPath, "src", "worktree_A.ts")), false);
      assertEquals(await pathExists(join(portalTargetPath, "src", "worktree_B.ts")), false);

      // Pointer paths should exist and point to canonical worktrees.
      await assertPointerPointsTo(env.tempDir, traceA, wtA);
      await assertPointerPointsTo(env.tempDir, traceB, wtB);

      // Feature branches should contain their respective file.
      const fileAFromGit = await gitStdout(portalTargetPath, ["show", `${branchA}:src/worktree_A.ts`]);
      assertStringIncludes(fileAFromGit, "export const A");

      const fileBFromGit = await gitStdout(portalTargetPath, ["show", `${branchB}:src/worktree_B.ts`]);
      assertStringIncludes(fileBFromGit, "export const B");
    } finally {
      await env.cleanup();
    }
  },
);

Deno.test(
  "[e2e][negative] Phase 37.6: worktree creation failure returns actionable error",
  async () => {
    const env = await TestEnvironment.create();

    try {
      const { portalAlias, portalTargetPath, loop } = await setupPortalWorktreeExecutionLoop(env);

      const traceId = crypto.randomUUID();
      const requestId = `request-${traceId.substring(0, 8)}`;
      const badBaseBranch = "does-not-exist";

      const planPath = await env.createPlan(traceId, requestId, {
        status: "review",
        agentRole: "senior-coder",
        portal: portalAlias,
        targetBranch: badBaseBranch,
        actions: [
          {
            tool: ToolName.WRITE_FILE,
            params: {
              path: "src/should_not_write.ts",
              content: "export const nope = true;\n",
            },
          },
        ],
      });

      const activePlanPath = await env.approvePlan(planPath);

      const result = await loop.processTask(activePlanPath);

      assertEquals(result.success, false);
      assertEquals(result.traceId, traceId);
      assertExists(result.error);

      // Actionable: mention worktree and/or the base branch ref that failed.
      assertStringIncludes(result.error, "worktree");
      assertStringIncludes(result.error, badBaseBranch);

      // Portal checkout should remain untouched.
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), "main");

      // The canonical worktree path should not exist (worktree add failed).
      const canonicalWorktreePath = join(env.tempDir, ".exa", "worktrees", portalAlias, traceId);
      assertEquals(await pathExists(canonicalWorktreePath), false);
    } finally {
      await env.cleanup();
    }
  },
);
