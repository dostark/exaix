/**
 * @module ReadStepLlmMetricsTest
 * @path tests/scenario_framework/tests/unit/read_step_llm_metrics_test.ts
 * @description Phase 140a Step 3 — RED-first tests. readStepLlmMetrics must sum
 * agent.execution_completed/agent.generation_completed rows from the real journal.db file
 * (same access pattern as step_executor.ts:currentMaxRowid), scoped to a (sinceRowid,
 * untilRowid] rowid window, and must not include rows outside that window.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_llm_metrics.ts, tests/scenario_framework/runner/step_executor.ts]
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
  const workspaceRoot = await Deno.makeTempDir({ prefix: `read-step-llm-metrics-${testName}-` });
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

interface IActivityFixturePayload {
  execution_time_ms?: number;
  duration_ms?: number;
}

interface IInsertActivityOptions {
  traceId?: string;
  actionType: string;
  payload: IActivityFixturePayload;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

function insertActivity(db: Database, options: IInsertActivityOptions): void {
  db.exec(
    `INSERT INTO activity (id, trace_id, actor, action_type, payload, prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens)
     VALUES (?, ?, 'agent-executor', ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      options.traceId ?? "trace-1",
      options.actionType,
      JSON.stringify(options.payload),
      options.promptTokens,
      options.completionTokens,
      options.cacheReadTokens ?? null,
      options.cacheCreationTokens ?? null,
    ],
  );
}

Deno.test({
  name: "[ReadStepLlmMetrics] sums execution_time_ms and tokens only for rows inside (sinceRowid, untilRowid]",
  fn: async () => {
    const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("in-window");
    try {
      insertActivity(db, {
        actionType: "agent.execution_completed",
        payload: { execution_time_ms: 999999, duration_ms: 999999 },
        promptTokens: 999,
        completionTokens: 999,
      });
      const sinceRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      insertActivity(db, {
        actionType: "agent.execution_completed",
        payload: { execution_time_ms: 1500, duration_ms: 1500 },
        promptTokens: 10,
        completionTokens: 20,
      });
      insertActivity(db, {
        actionType: "agent.generation_completed",
        payload: { duration_ms: 300 },
        promptTokens: 0,
        completionTokens: 0,
      });

      const untilRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      insertActivity(db, {
        actionType: "agent.execution_completed",
        payload: { execution_time_ms: 888888, duration_ms: 888888 },
        promptTokens: 888,
        completionTokens: 888,
      });

      const metrics = await readStepLlmMetrics(workspaceRoot, sinceRowid, untilRowid);

      assertEquals(metrics.llmDurationMs, 1500 + 300);
      assertEquals(metrics.tokens?.prompt, 10);
      assertEquals(metrics.tokens?.completion, 20);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[ReadStepLlmMetrics] sums cache_read_tokens/cache_creation_tokens from the activity table's dedicated columns",
  fn: async () => {
    const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("cache-tokens");
    try {
      const sinceRowid = 0;
      insertActivity(db, {
        actionType: "agent.generation_completed",
        payload: { duration_ms: 100 },
        promptTokens: 50,
        completionTokens: 25,
        cacheReadTokens: 40,
        cacheCreationTokens: 15,
      });
      insertActivity(db, {
        actionType: "agent.generation_completed",
        payload: { duration_ms: 100 },
        promptTokens: 50,
        completionTokens: 25,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
      });
      const untilRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      const metrics = await readStepLlmMetrics(workspaceRoot, sinceRowid, untilRowid);

      assertEquals(metrics.tokens?.cacheRead, 50);
      assertEquals(metrics.tokens?.cacheCreation, 20);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[ReadStepLlmMetrics] a window with no matching activity rows reports absent metrics, not an error",
  fn: async () => {
    const { workspaceRoot, cleanup } = await makeWorkspaceWithJournal("empty-window");
    try {
      const metrics = await readStepLlmMetrics(workspaceRoot, 0, 0);

      assertEquals(metrics.llmDurationMs, undefined);
      assertEquals(metrics.tokens, undefined);
      assertEquals(metrics.trackedCostUsd, undefined);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[ReadStepLlmMetrics] a missing journal.db (no daemon ever ran) reports absent metrics, not a thrown error",
  fn: async () => {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "read-step-llm-metrics-missing-db-" });
    try {
      const metrics = await readStepLlmMetrics(workspaceRoot, 0, 100);

      assertEquals(metrics.llmDurationMs, undefined);
      assertEquals(metrics.tokens, undefined);
      assertEquals(metrics.trackedCostUsd, undefined);
    } finally {
      await Deno.remove(workspaceRoot, { recursive: true });
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test("[ReadStepLlmMetrics] summary preference is per trace and confined to the rowid window", async () => {
  const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("summary-preference");
  try {
    insertActivity(db, {
      traceId: "outside-summary",
      actionType: "agent.execution_completed",
      payload: {},
      promptTokens: 999,
      completionTokens: 999,
      cacheReadTokens: 999,
    });
    const sinceRowid: number = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;
    insertActivity(db, {
      traceId: "outside-summary",
      actionType: "agent.generation_completed",
      payload: {},
      promptTokens: 2,
      completionTokens: 3,
      cacheReadTokens: 40,
    });
    for (const actionType of ["agent.generation_completed", "agent.execution_completed"]) {
      insertActivity(db, {
        traceId: "generation-and-summary",
        actionType,
        payload: {},
        promptTokens: 4,
        completionTokens: 5,
        cacheReadTokens: 10,
      });
    }
    insertActivity(db, {
      traceId: "summary-only",
      actionType: "agent.execution_completed",
      payload: {},
      promptTokens: 1,
      completionTokens: 1,
      cacheReadTokens: 0,
    });
    const untilRowid: number = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;
    const metrics = await readStepLlmMetrics(workspaceRoot, sinceRowid, untilRowid);
    assertEquals(metrics.tokens, {
      prompt: 7,
      completion: 9,
      total: 16,
      cacheRead: 50,
      cacheCreation: undefined,
    });
  } finally {
    await cleanup();
  }
});
