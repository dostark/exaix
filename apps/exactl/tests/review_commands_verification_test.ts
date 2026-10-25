/**
 * @module ReviewCommandsVerificationTest
 * @path apps/exactl/tests/review_commands_verification_test.ts
 * @related-files [apps/exactl/src/commands/review_commands.ts, apps/exactl/src/exactl.ts]
 * @architectural-layer Tests
 * @description `exactl review show` surfaces the post-execution verification outcome read
 *   from the trace's execution.completed row, and warns when verification failed or errored.
 */

import { assert, assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { ReviewCommands, verificationWarning } from "../src/commands/review_commands.ts";
import { createCliTestContext, initGitRepo, runGitCommand } from "./helpers/test_setup.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

async function createFeatureBranch(repoDir: string, requestId: string, traceId: string): Promise<string> {
  const branchName = `feat/${requestId}-${traceId}`;
  await runGitCommand(repoDir, ["checkout", "-b", branchName]);
  await Deno.writeTextFile(join(repoDir, "feature.txt"), `content ${branchName}\n`);
  await runGitCommand(repoDir, ["add", "feature.txt"]);
  await runGitCommand(repoDir, ["commit", "-m", `Add feature for ${requestId}`]);
  await runGitCommand(repoDir, ["checkout", TEST_DEFAULT_BRANCH]);
  return branchName;
}

describe("ReviewVerificationStatus", () => {
  let tempDir: string;
  let db: DatabaseService;
  let reviewCommands: ReviewCommands;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const ctx = await createCliTestContext();
    tempDir = ctx.tempDir;
    db = ctx.db;
    cleanup = ctx.cleanup;
    await initGitRepo(tempDir);
    reviewCommands = new ReviewCommands(ctx.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("[review-show] a review whose execution completed with verification_status failed shows the status and a warning", async () => {
    const branch = await createFeatureBranch(tempDir, "request-208", "vrf-failed");
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      {
        request_id: "request-208",
        verification_status: "failed",
      },
      "vrf-failed",
      null,
    );
    await db.waitForFlush();

    const details = await reviewCommands.show(branch);

    assertEquals(details.verification_status, "failed");
    const warning = verificationWarning(details.verification_status);
    assert(warning?.includes("failed"), warning);
    assert(verificationWarning("error")?.includes("error"));
  });

  it("[review-show] a historical completed row stays status-only and invents no lint details", async () => {
    const branch = await createFeatureBranch(tempDir, "request-210", "vrf-historic");
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      {
        request_id: "request-210",
        verification_status: "failed",
        failures: [{ task: "lint", exit_code: 1 }],
      },
      "vrf-historic",
      null,
    );
    await db.waitForFlush();

    const details = await reviewCommands.show(branch);

    assertEquals(details.verification_status, "failed");
    assertEquals(Object.hasOwn(details, "unslop"), false);
    assert(verificationWarning(details.verification_status)?.includes("failed"));
  });

  it("[review-show] a review with no verification block shows not_configured", async () => {
    const branch = await createFeatureBranch(tempDir, "request-209", "vrf-none");
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      {
        request_id: "request-209",
        verification_status: "not_configured",
      },
      "vrf-none",
      null,
    );
    await db.waitForFlush();

    const details = await reviewCommands.show(branch);

    assertEquals(details.verification_status, "not_configured");
    assertEquals(verificationWarning(details.verification_status), undefined);
  });
});

/** Logs one terminal unslop snapshot for the given run and commit. */
function logLintSnapshot(
  db: DatabaseService,
  traceId: string,
  requestId: string,
  runId: string,
  commitSha: string,
  payload: Record<string, unknown>,
): void {
  db.logActivity(
    "daemon",
    DomainEventType.ExecutionVerificationLintFindings,
    null,
    {
      request_id: requestId,
      run_id: runId,
      attempt: 0,
      commit_sha: commitSha,
      verification_status: "failed",
      total: 2,
      checks: [{ check_index: 0, outcome: "failed", total: 2, error_class: null }],
      findings: [{ check_index: 0, file: "src/seed.ts", line: 3, rule: "unslop/no-chained-type-assertions" }],
      truncated: true,
      ...payload,
    },
    traceId,
    null,
  );
}

describe("ReviewUnslopSnapshot", () => {
  let tempDir: string;
  let db: DatabaseService;
  let reviewCommands: ReviewCommands;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const ctx = await createCliTestContext();
    tempDir = ctx.tempDir;
    db = ctx.db;
    cleanup = ctx.cleanup;
    await initGitRepo(tempDir);
    reviewCommands = new ReviewCommands(ctx.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("[review-show] a failed run joins its final snapshot by run id and commit", async () => {
    const branch = await createFeatureBranch(tempDir, "request-229", "snp-failed");
    const commit = await runGitCommand(tempDir, ["rev-parse", branch]);
    const runId = crypto.randomUUID();
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      { request_id: "request-229", verification_status: "failed", verification_run_id: runId },
      "snp-failed",
      null,
    );
    logLintSnapshot(db, "snp-failed", "request-229", runId, commit, {});
    await db.waitForFlush();

    const details = await reviewCommands.show(branch);

    assertEquals(details.lint?.total, 2);
    assertEquals(details.lint?.findings.length, 1);
    assertEquals(details.lint?.findings[0].file, "src/seed.ts");
    assertEquals(details.lint?.truncated, true);
    assertEquals(details.lint?.unavailable, undefined);
  });

  it("[review-show] a repaired run shows zero remaining findings", async () => {
    const branch = await createFeatureBranch(tempDir, "request-230", "snp-repaired");
    const commit = await runGitCommand(tempDir, ["rev-parse", branch]);
    const runId = crypto.randomUUID();
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      { request_id: "request-230", verification_status: "repaired", verification_run_id: runId },
      "snp-repaired",
      null,
    );
    logLintSnapshot(db, "snp-repaired", "request-230", runId, commit, {
      verification_status: "repaired",
      total: 0,
      checks: [{ check_index: 0, outcome: "passed", total: 0, error_class: null }],
      findings: [],
      truncated: false,
    });
    await db.waitForFlush();

    const details = await reviewCommands.show(branch);

    assertEquals(details.lint?.total, 0);
    assertEquals(details.lint?.findings, []);
  });

  it("[review-show] a mismatched commit or malformed snapshot is unavailable", async () => {
    const branch = await createFeatureBranch(tempDir, "request-231", "snp-bad");
    const commit = await runGitCommand(tempDir, ["rev-parse", branch]);
    const runId = crypto.randomUUID();
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      { request_id: "request-231", verification_status: "failed", verification_run_id: runId },
      "snp-bad",
      null,
    );
    logLintSnapshot(db, "snp-bad", "request-231", runId, `${commit}-other`, {});
    await db.waitForFlush();
    assertEquals((await reviewCommands.show(branch)).lint?.unavailable, true);

    db.logActivity(
      "daemon",
      DomainEventType.ExecutionVerificationLintFindings,
      null,
      { request_id: "request-231", run_id: runId, commit_sha: commit, malformed: true },
      "snp-bad",
      null,
    );
    await db.waitForFlush();
    assertEquals((await reviewCommands.show(branch)).lint?.unavailable, true);
  });

  it("historical-completion-compatibility: a single legacy completion does not require a branch-name request encoding", async () => {
    const trace = crypto.randomUUID();
    const branch = await createFeatureBranch(tempDir, "execution-legacy", trace);
    await new ReviewRegistry(db, new EventLogger({ db })).register({
      trace_id: trace,
      branch,
      repository: tempDir,
      description: "legacy review",
      created_by: "agent",
      files_changed: 1,
      commit_sha: await runGitCommand(tempDir, ["rev-parse", branch]),
    });
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      { request_id: "execution-legacy", verification_status: "failed" },
      trace,
      null,
    );
    await db.waitForFlush();
    const details = await reviewCommands.show(branch);
    assertEquals(details.verification_status, "failed");
    assertEquals(details.lint, undefined);
  });

  it("[review-show] a historical completed row without a run id stays status-only", async () => {
    const branch = await createFeatureBranch(tempDir, "request-232", "snp-historic");
    db.logActivity(
      "daemon",
      DomainEventType.ExecutionCompleted,
      null,
      { request_id: "request-232", verification_status: "failed" },
      "snp-historic",
      null,
    );
    await db.waitForFlush();

    const details = await reviewCommands.show(branch);

    assertEquals(details.verification_status, "failed");
    assertEquals(details.lint, undefined);
  });
  for (const sameRequest of [false, true]) {
    it(sameRequest ? "same-request-rerun-review-identity" : "same-trace-two-review-commits", async () => {
      const trace = crypto.randomUUID();
      const firstRequest = "request-first";
      const secondRequest = sameRequest ? firstRequest : "request-second";
      const registry = new ReviewRegistry(db, new EventLogger({ db }));
      const first = await createFeatureBranch(tempDir, firstRequest, trace);
      const second = await createFeatureBranch(tempDir, secondRequest, `${trace}-rerun`);
      for (const [index, branch] of [first, second].entries()) {
        const commit = await runGitCommand(tempDir, ["rev-parse", branch]);
        const request = index === 0 ? firstRequest : secondRequest;
        const run = crypto.randomUUID();
        await registry.register({
          trace_id: trace,
          branch,
          repository: tempDir,
          description: "review fixture",
          created_by: "agent",
          files_changed: 1,
          commit_sha: commit,
        });
        db.logActivity(
          "daemon",
          DomainEventType.ExecutionCompleted,
          null,
          {
            request_id: request,
            commit_sha: commit,
            verification_status: index === 0 ? "failed" : "passed",
            verification_run_id: run,
          },
          trace,
          null,
        );
        logLintSnapshot(
          db,
          trace,
          request,
          run,
          commit,
          index === 0 ? {} : {
            verification_status: "passed",
            total: 0,
            checks: [{ check_index: 0, outcome: "passed", total: 0, error_class: null }],
            findings: [],
            truncated: false,
          },
        );
      }
      await db.waitForFlush();
      const older = await reviewCommands.show(first);
      assertEquals(older.verification_status, "failed");
      assert(verificationWarning(older.verification_status)?.includes("failed"));
      assertEquals(older.lint?.total, 2);
      assertEquals((await reviewCommands.show(second)).verification_status, "passed");
      assertEquals((await reviewCommands.show(second)).lint?.total, 0);
    });
  }
});
