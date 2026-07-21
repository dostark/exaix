/**
 * @module ReadStepLlmMetricsTrackedVsPredictedTest
 * @path tests/scenario_framework/tests/unit/read_step_llm_metrics_tracked_vs_predicted_test.ts
 * @description Phase 140a Step 3 — RED-first test. trackedCostUsd must sum only
 * agent.execution_completed rows whose payload.usage.cost_source is "tracked" — a
 * "predicted" (direct-API calculateCost() estimate) row must never contribute to
 * trackedCostUsd, and a window with only predicted rows must produce trackedCostUsd:
 * undefined rather than a silently-included predicted figure.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_llm_metrics.ts, packages/execution/src/agent_orchestrator.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { Database } from "@db/sqlite";
import { ACTIVITY_TABLE_SQL } from "@exaix/testing/helpers/init_db.ts";
import { readStepLlmMetrics } from "../../runner/step_llm_metrics.ts";

async function makeWorkspaceWithJournal(
  testName: string,
): Promise<{ workspaceRoot: string; db: Database; cleanup: () => Promise<void> }> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: `read-step-llm-metrics-cost-${testName}-` });
  const exaDir = join(workspaceRoot, ".exa");
  await ensureDir(exaDir);
  const dbPath = join(exaDir, "journal.db");
  const db = new Database(dbPath);
  db.exec(ACTIVITY_TABLE_SQL);
  return {
    workspaceRoot,
    db,
    cleanup: async () => {
      db.close();
      await Deno.remove(workspaceRoot, { recursive: true });
    },
  };
}

function insertExecutionCompleted(
  db: Database,
  costSource: "tracked" | "predicted",
  costUsd: number,
): void {
  db.exec(
    `INSERT INTO activity (id, trace_id, actor, action_type, payload, prompt_tokens, completion_tokens, cost_usd)
     VALUES (?, 'trace-1', 'agent-executor', 'agent.execution_completed', ?, 10, 10, ?)`,
    [
      crypto.randomUUID(),
      JSON.stringify({
        execution_time_ms: 100,
        duration_ms: 100,
        usage: { cost_source: costSource, cost_usd_estimate: costUsd },
      }),
      costUsd,
    ],
  );
}

Deno.test({
  name:
    "[ReadStepLlmMetricsTrackedVsPredicted] a window with one tracked and one predicted row sums only the tracked row's cost",
  fn: async () => {
    const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("mixed");
    try {
      insertExecutionCompleted(db, "tracked", 0.05);
      insertExecutionCompleted(db, "predicted", 0.9);
      const untilRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      const metrics = await readStepLlmMetrics(workspaceRoot, 0, untilRowid);

      assertEquals(metrics.trackedCostUsd, 0.05);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[ReadStepLlmMetricsTrackedVsPredicted] a window with only predicted rows produces trackedCostUsd: undefined",
  fn: async () => {
    const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("all-predicted");
    try {
      insertExecutionCompleted(db, "predicted", 0.42);
      const untilRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      const metrics = await readStepLlmMetrics(workspaceRoot, 0, untilRowid);

      assertEquals(metrics.trackedCostUsd, undefined);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[ReadStepLlmMetricsTrackedVsPredicted] multiple tracked rows sum their costs together",
  fn: async () => {
    const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("multi-tracked");
    try {
      insertExecutionCompleted(db, "tracked", 0.1);
      insertExecutionCompleted(db, "tracked", 0.2);
      const untilRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      const metrics = await readStepLlmMetrics(workspaceRoot, 0, untilRowid);

      assertEquals(metrics.trackedCostUsd, 0.1 + 0.2);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
