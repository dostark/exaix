/**
 * @module ExecutionLoopAmendmentWorktreeTest
 * @path packages/execution/tests/execution_loop_amendment_worktree_test.ts
 * @description Regression test: a plan that hits PlanAmendmentPendingError while
 * executing in a portal worktree must have that worktree removed before returning,
 * so the resumed (post-amendment-approval) run can `git worktree add` the same
 * traceId-scoped path again instead of colliding with the still-existing directory.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ExecutionLoop } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { ensureDir } from "@std/fs/ensure-dir";
import { PlanStatus } from "@exaix/core/status";
import { PlanAmendmentGate, PlanAmendmentService } from "@exaix/core/planning";
import { PLAN_AMENDMENT_EVENT_PROPOSED, PLAN_AMENDMENT_EVENT_REJECTED } from "@exaix/core";
import { PortalOperation } from "@exaix/core";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";

Deno.test(
  "[regression] ExecutionLoop: cleans up the portal worktree when a plan hits amendment-pending, so resume does not collide with it",
  async () => {
    const rootDir = await Deno.makeTempDir({ prefix: "exec-amend-worktree-" });
    const portalDir = join(rootDir, "my-portal");
    await ensureDir(portalDir);

    await new Deno.Command("git", { args: ["init", "-b", "master"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["config", "user.name", "Test User"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["config", "user.email", "test@test.com"], cwd: portalDir }).output();
    await Deno.writeTextFile(join(portalDir, ".gitignore"), "*.tmp\n");
    await new Deno.Command("git", { args: ["add", ".gitignore"], cwd: portalDir }).output();
    await new Deno.Command("git", { args: ["commit", "-m", "Initial commit"], cwd: portalDir }).output();

    const { db, cleanup } = await initTestDbService();
    try {
      // Non-JSON generate() responses fall through OutputParser.defaultResult(), whose
      // description is the step's own plan text (task title + content) — so a step whose
      // content carries hedging/uncertain language drives ConfidenceScorer.assessQuick()
      // below the threshold and triggers a real PlanAmendmentPendingError, the same
      // low_confidence path the plan-amendment-lifecycle scenario exercises. The amendment
      // proposal call (PlanAmendmentService.proposeAmendment) uses the same provider, so it
      // is distinguished by its own distinctive prompt text and answered with a valid patch.
      const uncertainLlm: IModelProvider = {
        id: "uncertain-mock",
        generate: (prompt: string): Promise<IGenerateResult> =>
          Promise.resolve({
            content: prompt.includes("ExaIx Plan Amendment specialist")
              ? JSON.stringify({
                summary: "Adjust remaining steps",
                affectedRemainingStepIds: ["2"],
                adds: [],
                updates: [],
                removes: [],
              })
              : "not json",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: "mock-model",
            provider: "mock",
            cost_usd: 0,
          }),
      };

      const config = createMockConfig(rootDir, {
        amendment: {
          enabled: true,
          threshold: 80,
          expiryMs: 86_400_000,
          hitl_timeout_ms: 300_000,
          on_timeout: "abort",
        },
      });
      config.portals = [{
        alias: "my-portal",
        target_path: portalDir,
        default_branch: "master",
        identities_allowed: ["*"],
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      }];

      const activeDir = join(rootDir, config.paths.workspace, "Active");
      await ensureDir(activeDir);

      const logger = new EventLogger({ db, defaultActor: "user:test" });
      const reviewRegistry = new ReviewRegistry(db, logger);
      const amendmentService = new PlanAmendmentService(config, uncertainLlm);
      const amendmentGate = new PlanAmendmentGate(config, amendmentService, undefined, logger);
      const loop = new ExecutionLoop({
        config,
        db,
        logger,
        identityId: "test-agent",
        llmProvider: uncertainLlm,
        reviewRegistry,
        amendmentService,
        amendmentGate,
        gitServiceFactory: {
          createGitService(repoPath: string, traceId: string) {
            return new GitService({ config, traceId, identityId: "test-agent", repoPath });
          },
        },
        toolRegistryFactory: {
          createToolRegistry(traceId: string, baseDir: string) {
            return new ToolRegistry({ config, traceId, identityId: "test-agent", baseDir });
          },
        },
        memoryBank: new MemoryBankService(config, logger),
      });

      const traceId = crypto.randomUUID();
      const requestId = "amend-worktree-request";
      const planContent = `---
trace_id: "${traceId}"
request_id: ${requestId}
status: ${PlanStatus.APPROVED}
portal: my-portal
---

# Amendment Worktree Regression Plan

## Execution Steps

## Step 1: Uncertain step

I am not sure perhaps uncertain maybe this could be wrong, however it might work.

## Step 2: Follow-up step

Finish the task.
`;

      const planPath = join(activeDir, `${requestId}_plan.md`);
      await Deno.writeTextFile(planPath, planContent);

      const worktreePath = join(rootDir, ".exa", "worktrees", "my-portal", traceId);

      // First pass: the low-confidence step 1 triggers PlanAmendmentPendingError.
      // The plan is marked amendment_pending in place (handleAmendmentPending) and the
      // run reports success (the loop pauses, it did not fail) — but the worktree it
      // created for this traceId must NOT be left behind.
      const firstResult = await loop.processTask(planPath);
      assertEquals(firstResult.success, true, "Amendment-pending pause should report success: " + firstResult.error);

      await db.waitForFlush();
      const activities = await db.getActivitiesByTrace(traceId);
      const proposalEvents = activities.filter(
        (activity) => activity.action_type === PLAN_AMENDMENT_EVENT_PROPOSED,
      );
      assertEquals(proposalEvents.length, 1, "real execution must emit one trace-scoped proposal event");
      const pendingEvents = activities.filter(
        (activity) => activity.action_type === "execution.amendment_pending",
      );
      assertEquals(pendingEvents.length, 1, "real execution must emit one trace-scoped pending event");
      assertEquals(JSON.parse(pendingEvents[0].payload).request_id, requestId);
      assertEquals(
        JSON.parse(pendingEvents[0].payload).amendment_id,
        JSON.parse(proposalEvents[0].payload).amendmentId,
      );

      const worktreeStillExists = await Deno.stat(worktreePath).then(() => true).catch(() => false);
      assertEquals(
        worktreeStillExists,
        false,
        "worktree must be removed when a plan pauses for amendment, or the resumed run's " +
          "`git worktree add` collides with the orphaned directory",
      );

      // Second pass: simulate the resumed run after amendment approval — status flips
      // back to approved (what PlanCommands.approveAmendment does to the on-disk plan,
      // which handleAmendmentPending already rewrote to amendment_pending above) and the
      // loop picks the plan up again. It must be able to create the worktree again, not
      // fail with "already exists".
      const pausedContent = await Deno.readTextFile(planPath);
      const resumedContent = pausedContent.replace(
        `status: ${PlanStatus.AMENDMENT_PENDING}`,
        `status: ${PlanStatus.APPROVED}`,
      );
      await Deno.writeTextFile(planPath, resumedContent);

      const secondResult = await loop.processTask(planPath);
      assertExists(secondResult, "resumed run must complete");
      const errorMentionsAlreadyExists = (secondResult.error ?? "").includes("already exists");
      assertEquals(
        errorMentionsAlreadyExists,
        false,
        "resumed run must not fail with a worktree collision: " + secondResult.error,
      );
    } finally {
      await cleanup();
      await Deno.remove(rootDir, { recursive: true });
    }
  },
);

Deno.test("ExecutionLoop routes an expired amendment rejection through IPlanAmendmentGate", async () => {
  const rootDir = await Deno.makeTempDir({ prefix: "exec-amend-reject-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const traceId = crypto.randomUUID();
    const requestId = "amend-reject-request";
    const config = createMockConfig(rootDir, {
      amendment: {
        enabled: true,
        threshold: 80,
        expiryMs: 1,
        hitl_timeout_ms: 1,
        on_timeout: "reject",
      },
    });
    const activeDir = join(rootDir, config.paths.workspace, config.paths.active);
    await ensureDir(activeDir);
    await Deno.writeTextFile(
      join(activeDir, `${requestId}_plan.md`),
      `---\ntrace_id: "${traceId}"\nrequest_id: ${requestId}\nstatus: ${PlanStatus.AMENDMENT_PENDING}\namendment_id: 550e8400-e29b-41d4-a716-446655440099\namendment_proposed_at: "2000-01-01T00:00:00.000Z"\n---\n\n# Expired Amendment\n`,
    );

    const logger = new EventLogger({ db, defaultActor: "user:test" });
    const amendmentService = new PlanAmendmentService(config, {} as IModelProvider);
    const amendmentGate = new PlanAmendmentGate(config, amendmentService, undefined, logger);
    const loop = new ExecutionLoop({
      config,
      db,
      logger,
      identityId: "test-agent",
      amendmentService,
      amendmentGate,
    });

    await loop.executeNext();
    await db.waitForFlush();

    const rejectionEvents = (await db.getActivitiesByTrace(traceId)).filter(
      (activity) => activity.action_type === PLAN_AMENDMENT_EVENT_REJECTED,
    );
    assertEquals(rejectionEvents.length, 1, "expired amendment must emit one correlated rejection");
    assertEquals(JSON.parse(rejectionEvents[0].payload).decision, "rejected");
  } finally {
    await cleanup();
    await Deno.remove(rootDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop routes an expired amendment approval through IPlanAmendmentGate", async () => {
  const rootDir = await Deno.makeTempDir({ prefix: "exec-amend-approve-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const traceId = crypto.randomUUID();
    const requestId = "amend-approve-request";
    const amendmentId = "550e8400-e29b-41d4-a716-446655440098";
    const config = createMockConfig(rootDir, {
      amendment: {
        enabled: true,
        threshold: 80,
        expiryMs: 1,
        hitl_timeout_ms: 1,
        on_timeout: "approve",
      },
    });
    const activeDir = join(rootDir, config.paths.workspace, config.paths.active);
    await ensureDir(activeDir);
    await Deno.writeTextFile(
      join(activeDir, `${requestId}_plan.md`),
      `---\ntrace_id: "${traceId}"\nrequest_id: ${requestId}\nstatus: ${PlanStatus.AMENDMENT_PENDING}\namendment_id: ${amendmentId}\namendment_proposed_at: "2000-01-01T00:00:00.000Z"\n---\n\n# Expired Amendment\n`,
    );

    const logger = new EventLogger({ db, defaultActor: "user:test" });
    const amendmentService = new PlanAmendmentService(config, {} as IModelProvider);
    const amendmentGate = new PlanAmendmentGate(config, amendmentService, undefined, logger);
    const loop = new ExecutionLoop({
      config,
      db,
      logger,
      identityId: "test-agent",
      amendmentService,
      amendmentGate,
    });

    await loop.executeNext();
    await db.waitForFlush();

    const approvalEvents = (await db.getActivitiesByTrace(traceId)).filter(
      (activity) => activity.action_type === "plan.amendment.approved",
    );
    assertEquals(approvalEvents.length, 1, "expired amendment must emit one correlated approval");
    assertEquals(JSON.parse(approvalEvents[0].payload).decision, "approved");
  } finally {
    await cleanup();
    await Deno.remove(rootDir, { recursive: true });
  }
});
