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
import { DomainEventType } from "@exaix/core/events";
import { ReviewCommands, verificationWarning } from "../src/commands/review_commands.ts";
import { createCliTestContext, initGitRepo, runGitCommand } from "./helpers/test_setup.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

async function createFeatureBranch(repoDir: string, requestId: string, traceId: string): Promise<string> {
  const branchName = `feat/${requestId}-${traceId}`;
  await runGitCommand(repoDir, ["checkout", "-b", branchName]);
  await Deno.writeTextFile(join(repoDir, "feature.txt"), "content\n");
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
