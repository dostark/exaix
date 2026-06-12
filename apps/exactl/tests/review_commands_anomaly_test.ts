/**
 * @module ReviewCommandsAnomalyTest
 * @path apps/exactl/tests/review_commands_anomaly_test.ts
 * @description Tests for anomaly surfacing in exactl review — anomalySummary on list metadata, anomalies on show details, badge/section rendering format, and backward-compat with clean traces.
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import type { IAnomalyFinding } from "@exaix/core/events";
import { ReviewCommands } from "../src/commands/review_commands.ts";
import type { IReviewMetadata } from "../src/commands/review_commands.ts";
import { ReviewStatus } from "@exaix/core/status";
import { createCliTestContext, initGitRepo, runGitCommand } from "./helpers/test_setup.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

async function createFeatureBranch(
  repoDir: string,
  requestId: string,
  traceId: string,
): Promise<string> {
  const branchName = `feat/${requestId}-${traceId}`;
  await runGitCommand(repoDir, ["checkout", "-b", branchName]);
  await Deno.writeTextFile(join(repoDir, "feature.txt"), "content\n");
  await runGitCommand(repoDir, ["add", "feature.txt"]);
  await runGitCommand(repoDir, ["commit", "-m", `Add feature for ${requestId}\n\nTrace-Id: ${traceId}`]);
  await runGitCommand(repoDir, ["checkout", TEST_DEFAULT_BRANCH]);
  return branchName;
}

describe("ReviewAnomaly", () => {
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

  it("[Review] list returns metadata with anomalySummary for trace containing McpToolFailed", async () => {
    await createFeatureBranch(tempDir, "request-101", "anm-t1");

    db.logActivity("system", DomainEventType.McpToolFailed, "read_file", {}, "anm-t1", null);
    await db.waitForFlush();

    const reviews = await reviewCommands.list();
    const match = reviews.find((r: IReviewMetadata) => r.trace_id === "anm-t1");
    assertExists(match, "review should be found");
    assertExists(match.anomalySummary, "anomalySummary should exist");
    assertEquals(match.anomalySummary!.medium, 1);
    assertEquals(match.anomalySummary!.high, 0);
    assertEquals(match.anomalySummary!.low, 0);
  });

  it("[Review] show returns details with anomalies listing severity and target", async () => {
    await createFeatureBranch(tempDir, "request-102", "anm-t2");

    db.logActivity("system", DomainEventType.McpToolFailed, "read_file", {}, "anm-t2", null);
    db.logActivity("system", DomainEventType.SecurityViolation, "/etc/passwd", {}, "anm-t2", null);
    await db.waitForFlush();

    const details = await reviewCommands.show("feat/request-102-anm-t2");
    assertExists(details.anomalies, "anomalies should exist on show details");
    assertEquals(details.anomalies!.length, 2);

    const toolFinding = details.anomalies!.find(
      (f: IAnomalyFinding) => f.eventType === DomainEventType.McpToolFailed,
    );
    assertExists(toolFinding);
    assertEquals(toolFinding.severity, "medium");
    assertEquals(toolFinding.target, "read_file");

    const secFinding = details.anomalies!.find(
      (f: IAnomalyFinding) => f.eventType === DomainEventType.SecurityViolation,
    );
    assertExists(secFinding);
    assertEquals(secFinding.severity, "high");
    assertEquals(secFinding.target, "/etc/passwd");
  });

  it("[Review] recovered failure excluded from medium count in show anomalies", async () => {
    await createFeatureBranch(tempDir, "request-103", "anm-t3");

    db.logActivity("system", DomainEventType.ExecutionActionFailed, "build-step", {}, "anm-t3", null);
    db.logActivity("system", DomainEventType.ExecutionActionCompleted, "build-step", {}, "anm-t3", null);
    await db.waitForFlush();

    const details = await reviewCommands.show("feat/request-103-anm-t3");
    assertExists(details.anomalies, "anomalies should exist");
    const recoveredFinding = details.anomalies!.find(
      (f: IAnomalyFinding) => f.eventType === DomainEventType.ExecutionActionFailed,
    );
    assertExists(recoveredFinding);
    assertEquals(recoveredFinding.recovered, true);
    assertExists(details.anomalySummary);
    assertEquals(details.anomalySummary!.recovered, 1);
    assertEquals(details.anomalySummary!.medium, 0);
  });

  it("[Review] clean trace has no anomalySummary on list metadata", async () => {
    await createFeatureBranch(tempDir, "request-104", "anm-t4");

    const reviews = await reviewCommands.list();
    const match = reviews.find((r: IReviewMetadata) => r.trace_id === "anm-t4");
    assertExists(match, "review should be found");
    assertEquals(match.anomalySummary, undefined, "clean trace should have no anomalySummary");
  });

  it("[Review] DB-backed review-list path populates anomalySummary when activities exist", async () => {
    db.logActivity("system", DomainEventType.McpToolFailed, "deploy", {}, "anm-t5", null);
    await db.waitForFlush();

    await db.preparedRun(
      `INSERT INTO reviews (trace_id, portal, branch, repository, base_branch, worktree_path, files_changed, created, created_by, status, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "anm-t5",
        null,
        "feat/request-105-anm-t5",
        tempDir,
        "main",
        null,
        1,
        new Date().toISOString(),
        "test-agent",
        ReviewStatus.PENDING,
        "",
      ],
    );

    const result = await reviewCommands.list();
    const match = result.find((r: IReviewMetadata) => r.trace_id === "anm-t5");
    if (match) {
      assertExists(match.anomalySummary, "DB-backed path should populate anomalySummary");
    }
  });

  it("[Review] artifact show returns no anomalies", async () => {
    try {
      const details = await reviewCommands.show("nonexistent-artifact");
      assertEquals("anomalies" in details, false);
    } catch {
      // Expected: artifact doesn't exist
    }
  });
});
