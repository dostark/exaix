/**
 * @module ExecutionLoopRepairTest
 * @path packages/execution/tests/execution_loop_repair_test.ts
 * @related-files ["packages/execution/src/execution_loop.ts", "packages/core/src/planning/plan_executor.ts"]
 * @architectural-layer Tests
 * @description Drives the bounded verification repair loop through the
 *   verificationRunnerFactory seam and a prototype stub of executeStructuredPlan,
 *   asserting the status, the repair events and the review commit.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { stub } from "@std/testing/mock";
import { ExecutionLoop, type IVerificationRunContext, type IVerificationRunner } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { castAny, createMockConfig, initTestDbService } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { PortalOperation } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import type { IGitService } from "@exaix/core/types";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import { PlanStatus } from "@exaix/core/status";
import {
  type IPortalVerification,
  type IVerificationResult,
  PortalVerificationSchema,
  type VerificationStatus,
} from "@exaix/schemas";

interface IRepairPlanStepCapture {
  content: string;
  successCriteria?: string[];
}

interface IRepairCall {
  steps: IRepairPlanStepCapture[];
  options: {
    reuseCurrentBranch?: boolean;
    commitCompletion?: boolean;
    disableAmendments?: boolean;
    runPhase?: string;
  };
}

interface IExecutionLoopInternals {
  executeStructuredPlan: (
    plan: { steps: IRepairPlanStepCapture[] },
    executionRoot: string,
    gitService: IGitService,
    frontmatter: PlanFrontmatter,
    planPath: string,
    options: IRepairCall["options"],
  ) => Promise<{ lastCommitSha: string | null }>;
}

class ScriptedVerificationRunner implements IVerificationRunner {
  calls = 0;
  readonly attempts: number[] = [];
  constructor(private readonly results: IVerificationResult[]) {}

  run(_config: IPortalVerification, context: IVerificationRunContext): Promise<IVerificationResult> {
    this.attempts.push(context.attempt);
    const result = this.results[this.calls] ?? this.results[this.results.length - 1];
    this.calls++;
    return Promise.resolve(result);
  }
}

const PASSED: IVerificationResult = { passed: true, error: false, failures: [] };
const FAILED: IVerificationResult = {
  passed: false,
  error: false,
  failures: [{ task: "test", exit_code: 1, output: "boom" }],
};
const ERRORED: IVerificationResult = {
  passed: false,
  error: true,
  failures: [{ task: "test", exit_code: null, output: "" }],
};

async function initPortalRepo(portalDir: string): Promise<void> {
  await ensureDir(portalDir);
  for (
    const args of [
      ["init", "-b", "master"],
      ["config", "user.name", "Test User"],
      ["config", "user.email", "test@test.com"],
    ]
  ) {
    await new Deno.Command("git", { args, cwd: portalDir }).output();
  }
  await Deno.writeTextFile(join(portalDir, ".gitignore"), "*.tmp\n");
  await new Deno.Command("git", { args: ["add", ".gitignore"], cwd: portalDir }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "Initial commit"], cwd: portalDir }).output();
}

function actionPlan(traceId: string, requestId: string): string {
  return `---
trace_id: "${traceId}"
request_id: ${requestId}
status: ${PlanStatus.APPROVED}
portal: my-portal
---

# Repair Plan

\`\`\`toml
tool = "write_file"
description = "Original step one"

[params]
path = "fail_test.ts"
content = "Deno.test(\\"fail\\", () => { throw new Error(\\"boom\\"); });\\n"
\`\`\`
`;
}

interface IRepairHandle {
  rootDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  cleanupDb: () => Promise<void>;
  reviewRegistry: ReviewRegistry;
  traceId: string;
}

async function runRepairScenario(options: {
  prefix: string;
  verification: IPortalVerification;
  results: IVerificationResult[];
  behavior: "commit" | "noop" | "throw";
  amendmentEnabled?: boolean;
}): Promise<
  { handle: IRepairHandle; runner: ScriptedVerificationRunner; calls: IRepairCall[]; branchAtRepair?: string }
> {
  const rootDir = await Deno.makeTempDir({ prefix: options.prefix });
  const portalDir = join(rootDir, "my-portal");
  await initPortalRepo(portalDir);

  const { db, cleanup: cleanupDb } = await initTestDbService();
  const traceId = crypto.randomUUID();

  const config = createMockConfig(rootDir, {
    ...(options.amendmentEnabled
      ? {
        amendment: {
          enabled: true,
          threshold: 90,
          expiryMs: 86_400_000,
          hitl_timeout_ms: 300_000,
          on_timeout: "abort" as const,
        },
      }
      : {}),
    portals: [{
      alias: "my-portal",
      target_path: portalDir,
      default_branch: "master",
      agents_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      verification: options.verification,
    }],
  });

  const activeDir = join(rootDir, config.paths.workspace, "Active");
  await ensureDir(activeDir);

  const logger = new EventLogger({ db, defaultActor: "user:test" });
  const reviewRegistry = new ReviewRegistry(db, logger);
  const runner = new ScriptedVerificationRunner(options.results);
  const calls: IRepairCall[] = [];
  let branchAtRepair: string | undefined;

  const loop = new ExecutionLoop({
    config,
    db,
    logger,
    agentRole: "test-agent",
    reviewRegistry,
    verificationRunnerFactory: () => runner,
    gitServiceFactory: {
      createGitService(repoPath: string, trace: string) {
        return new GitService({ config, traceId: trace, agentRole: "test-agent", repoPath });
      },
    },
    toolRegistryFactory: {
      createToolRegistry(trace: string, baseDir: string) {
        return new ToolRegistry({ config, traceId: trace, agentRole: "test-agent", baseDir });
      },
    },
    memoryBank: new MemoryBankService(config, logger),
  });

  const planPath = join(activeDir, `${options.behavior}.md`);
  await Deno.writeTextFile(planPath, actionPlan(traceId, `repair-${options.behavior}`));

  const repairStub = stub(
    castAny<IExecutionLoopInternals>(ExecutionLoop.prototype),
    "executeStructuredPlan",
    async (
      plan: { steps: IRepairPlanStepCapture[] },
      executionRoot: string,
      gitService: IGitService,
      _frontmatter: PlanFrontmatter,
      _planPath: string,
      planOptions: IRepairCall["options"],
    ) => {
      calls.push({ steps: plan.steps, options: planOptions });
      if (options.behavior === "throw") throw new Error("repair exploded");
      branchAtRepair = await gitService.getCurrentBranch();
      if (options.behavior === "commit") {
        await Deno.writeTextFile(join(executionRoot, "fixed.ts"), "export const fixed = 1;\n");
        await new Deno.Command("git", { args: ["add", "-A"], cwd: executionRoot }).output();
        await new Deno.Command("git", { args: ["commit", "-m", "repair"], cwd: executionRoot }).output();
        const head = await gitService.runGitCommand(["rev-parse", "HEAD"]);
        return { lastCommitSha: head.output.trim() };
      }
      return { lastCommitSha: null };
    },
  );

  try {
    const result = await loop.processTask(planPath);
    assert(result.success, result.error);
  } finally {
    repairStub.restore();
  }

  return { handle: { rootDir, db, cleanupDb, reviewRegistry, traceId }, runner, calls, branchAtRepair };
}

function completedStatus(db: IRepairHandle["db"], traceId: string): VerificationStatus {
  const rows = db.getActivitiesByTrace(traceId).filter((row) => row.action_type === "execution.completed");
  return JSON.parse(rows[0].payload).verification_status as VerificationStatus;
}

function eventPayloads(db: IRepairHandle["db"], traceId: string, action: string): Array<Record<string, JSONValue>> {
  return db.getActivitiesByTrace(traceId)
    .filter((row) => row.action_type === action)
    .map((row) => JSON.parse(row.payload) as Record<string, JSONValue>);
}

const VERIFICATION = PortalVerificationSchema.parse({
  checks: [{ kind: "deno_task", task: "test" }],
  max_repair_attempts: 2,
});

Deno.test("[execution-repair] a failing test fixed by the scripted repair step completes as repaired with two verification runs", async () => {
  const { handle, runner, calls, branchAtRepair } = await runRepairScenario({
    prefix: "exec-repair-fixed-",
    verification: VERIFICATION,
    results: [FAILED, PASSED],
    behavior: "commit",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "repaired");
    assertEquals(runner.calls, 2);
    assertEquals(runner.attempts, [0, 1]);

    const repairCompleted = eventPayloads(handle.db, handle.traceId, "execution.repair.completed");
    assertEquals(repairCompleted.length, 1);
    assert(repairCompleted[0].commit_sha !== null, "the repair event must carry the repair commit");
    assertEquals(repairCompleted[0].changed_files, ["fixed.ts"]);

    assertEquals(calls.length, 1);
    assertEquals(calls[0].options.reuseCurrentBranch, true);
    assertEquals(calls[0].options.commitCompletion, false);
    assertEquals(calls[0].options.disableAmendments, true);
    assertEquals(calls[0].options.runPhase, "repair");

    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].commit_sha, repairCompleted[0].commit_sha);
    assertEquals(reviews[0].branch, branchAtRepair, "the review branch must be the original execution branch");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-repair] a repair that does not fix the check stops after max_repair_attempts and emits exhausted", async () => {
  const { handle, runner, calls } = await runRepairScenario({
    prefix: "exec-repair-exhaust-",
    verification: VERIFICATION,
    results: [FAILED, FAILED, FAILED],
    behavior: "noop",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    assertEquals(runner.calls, 3);
    assertEquals(calls.length, 2);
    const exhausted = eventPayloads(handle.db, handle.traceId, "execution.verification.exhausted");
    assertEquals(exhausted.length, 1);
    assertEquals(exhausted[0].attempts, 2);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-repair] max_repair_attempts 0 never runs a repair step", async () => {
  const zeroBudget = PortalVerificationSchema.parse({
    checks: [{ kind: "deno_task", task: "test" }],
    max_repair_attempts: 0,
  });
  const { handle, runner, calls } = await runRepairScenario({
    prefix: "exec-repair-zero-",
    verification: zeroBudget,
    results: [FAILED],
    behavior: "noop",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    assertEquals(runner.calls, 1);
    assertEquals(calls.length, 0);
    assertEquals(eventPayloads(handle.db, handle.traceId, "execution.repair.started").length, 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-repair] an error status never triggers a repair", async () => {
  const { handle, runner, calls } = await runRepairScenario({
    prefix: "exec-repair-error-",
    verification: VERIFICATION,
    results: [ERRORED],
    behavior: "noop",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "error");
    assertEquals(runner.calls, 1);
    assertEquals(calls.length, 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-repair] a repair step that throws still registers the review on the original commit and completes as failed", async () => {
  const { handle } = await runRepairScenario({
    prefix: "exec-repair-throw-",
    verification: VERIFICATION,
    results: [FAILED],
    behavior: "throw",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "failed");
    const repairCompleted = eventPayloads(handle.db, handle.traceId, "execution.repair.completed");
    assertEquals(repairCompleted.length, 1);
    assertEquals(repairCompleted[0].commit_sha, null);
    assertEquals(repairCompleted[0].error_class, "Error");

    const reviews = await handle.reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1, "the review must be registered on the original commit");
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-repair] the repair step carries the original step titles and one success criterion per check", async () => {
  const { handle, calls } = await runRepairScenario({
    prefix: "exec-repair-content-",
    verification: VERIFICATION,
    results: [FAILED, PASSED],
    behavior: "noop",
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(calls.length, 1);
    const step = calls[0].steps[0];
    assert(step.content.includes("Original plan steps:"), step.content);
    assert(step.content.includes("Original step one"), step.content);
    assert(step.content.includes("untrusted tool output"), step.content);
    assertEquals(step.successCriteria, ["deno test . exits 0"]);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});

Deno.test("[execution-repair] a low-confidence repair step never proposes an amendment", async () => {
  const { handle, calls } = await runRepairScenario({
    prefix: "exec-repair-amend-",
    verification: VERIFICATION,
    results: [FAILED, PASSED],
    behavior: "noop",
    amendmentEnabled: true,
  });
  try {
    await handle.db.waitForFlush();
    assertEquals(completedStatus(handle.db, handle.traceId), "repaired");
    assertEquals(calls[0].options.disableAmendments, true);
    assertEquals(eventPayloads(handle.db, handle.traceId, "plan.amendment_triggered").length, 0);
    assertEquals(eventPayloads(handle.db, handle.traceId, "execution.amendment_pending").length, 0);
  } finally {
    await handle.cleanupDb();
    await Deno.remove(handle.rootDir, { recursive: true });
  }
});
