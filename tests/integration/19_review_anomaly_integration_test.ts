/**
 * @module ReviewAnomalyIntegrationTest
 * @path tests/integration/19_review_anomaly_integration_test.ts
 * @description End-to-end integration test for anomaly surfacing in exactl review.
 * Seeds the DB with activity events and reviews via the DB-backed path (no git),
 * then verifies anomalySummary on list() and anomalies on show().
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import type { IAnomalyFinding } from "@exaix/core/events";
import { ReviewCommands } from "../../apps/exactl/src/commands/review_commands.ts";
import type { IReviewMetadata } from "../../apps/exactl/src/commands/review_commands.ts";
import { ReviewStatus } from "@exaix/core/status";
import { createCliTestContext, initGitRepo, runGitCommand } from "../../apps/exactl/tests/helpers/test_setup.ts";
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

describe("ReviewAnomalyIntegration", () => {
  it(
    "[Integration] review list shows anomalySummary for DB-backed review with McpToolFailed and SecurityViolation",
    async () => {
      const { db, tempDir, context, cleanup } = await createCliTestContext();
      try {
        const traceId = "int-anm-list";
        const branchName = "feat/request-01-int-anm-list";

        db.logActivity("system", DomainEventType.McpToolFailed, "deploy-tool", {}, traceId, null);
        db.logActivity("system", DomainEventType.SecurityViolation, "/etc/shadow", {}, traceId, null);
        await db.waitForFlush();

        await db.preparedRun(
          `INSERT INTO reviews (trace_id, portal, branch, repository, base_branch, worktree_path, files_changed, created, created_by, status, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            traceId,
            null,
            branchName,
            tempDir,
            "main",
            null,
            3,
            new Date().toISOString(),
            "test-agent",
            ReviewStatus.PENDING,
            "Integration test review",
          ],
        );

        const reviewCommands = new ReviewCommands(context);
        const result = await reviewCommands.list();
        const match = result.find((r: IReviewMetadata) => r.trace_id === traceId);
        assertExists(match, "review should be found in list");
        assertExists(match.anomalySummary, "anomalySummary should exist");
        assertEquals(match.anomalySummary!.high, 1);
        assertEquals(match.anomalySummary!.medium, 1);
      } finally {
        await cleanup();
      }
    },
  );

  it(
    "[Integration] review show returns anomaly findings for trace with mixed live and recovered anomalies",
    async () => {
      const { db, tempDir, context, cleanup } = await createCliTestContext();
      try {
        const traceId = "int-anm-show";
        const requestId = "request-02";

        await initGitRepo(tempDir);
        const branchName = await createFeatureBranch(tempDir, requestId, traceId);

        db.logActivity("system", DomainEventType.ExecutionActionFailed, "compile-step", {}, traceId, null);
        db.logActivity("system", DomainEventType.ExecutionActionCompleted, "compile-step", {}, traceId, null);
        db.logActivity("system", DomainEventType.McpPermissionDenied, "restricted-api", {}, traceId, null);
        await db.waitForFlush();

        const reviewCommands = new ReviewCommands(context);
        const details = await reviewCommands.show(branchName);
        assertExists(details.anomalies, "anomalies should exist on show details");
        assertEquals(details.anomalies!.length, 2);

        const recoveredFinding = details.anomalies!.find(
          (f: IAnomalyFinding) => f.eventType === DomainEventType.ExecutionActionFailed,
        );
        assertExists(recoveredFinding, "recovered finding should exist");
        assertEquals(recoveredFinding.recovered, true);

        const permFinding = details.anomalies!.find(
          (f: IAnomalyFinding) => f.eventType === DomainEventType.McpPermissionDenied,
        );
        assertExists(permFinding, "permission finding should exist");
        assertEquals(permFinding.severity, "high");

        assertExists(details.anomalySummary, "anomalySummary should exist");
        assertEquals(details.anomalySummary!.recovered, 1);
        assertEquals(details.anomalySummary!.high, 1);
      } finally {
        await cleanup();
      }
    },
  );
});
