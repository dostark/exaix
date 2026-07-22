/**
 * @module EvalHistorySqliteV4ColumnAlignmentTest
 * @path packages/eval-history/tests/history_sqlite_v4_column_alignment_test.ts
 * @description Phase 140a Step 4 — RED-first test. insertStep/insertRun use purely positional
 * '?' placeholders matched to a fixed column list — a misordered positional bind does not
 * throw, it silently lands a value in the wrong column. Writes distinct, easily-distinguishable
 * sentinel values for every new v4 field and reads them back via a raw SELECT, asserting each
 * value lands in its own named column, not an adjacent one.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore, type IEvalHistoryEntry } from "@exaix/eval-history";

function makeTestEntry(overrides: Partial<IEvalHistoryEntry> = {}): IEvalHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    scenario_id: "sentinel-test",
    pack: "smoke",
    outcome: "success",
    mode: "auto",
    suite_score: 0.95,
    passed: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

Deno.test("[EvalHistorySqliteV4ColumnAlignment] eval_run_steps sentinel values land in their own named columns", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-v4-align-step-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();
    const entry = makeTestEntry({ run_id: "sentinel-step-run" });

    store.writeRun(entry, [
      {
        stepId: "sentinel-step",
        stepType: "shell",
        score: 1.0,
        executionStatus: "passed",
        durationMs: 111,
        llmDurationMs: 222,
        tokens: { prompt: 333, completion: 444, cacheRead: 555, cacheCreation: 666, total: 999 },
        trackedCostUsd: 7.77,
      },
    ]);

    const db = store["db"];
    const row = db.prepare(
      `SELECT duration_ms, llm_duration_ms, tokens_prompt, tokens_completion, tokens_cache_read,
              tokens_cache_creation, tracked_cost_usd
       FROM eval_run_steps WHERE run_id = ?`,
    ).get<{
      duration_ms: number;
      llm_duration_ms: number;
      tokens_prompt: number;
      tokens_completion: number;
      tokens_cache_read: number;
      tokens_cache_creation: number;
      tracked_cost_usd: number;
    }>("sentinel-step-run");

    assertEquals(row?.duration_ms, 111);
    assertEquals(row?.llm_duration_ms, 222);
    assertEquals(row?.tokens_prompt, 333);
    assertEquals(row?.tokens_completion, 444);
    assertEquals(row?.tokens_cache_read, 555);
    assertEquals(row?.tokens_cache_creation, 666);
    assertEquals(row?.tracked_cost_usd, 7.77);
  } finally {
    store.close();
  }
});

Deno.test("[EvalHistorySqliteV4ColumnAlignment] eval_runs sentinel aggregate values land in their own named columns", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-v4-align-run-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();
    const entry = makeTestEntry({
      run_id: "sentinel-agg-run",
      total_llm_duration_ms: 1111,
      total_tokens_prompt: 2222,
      total_tokens_completion: 3333,
      total_tokens_cache_read: 4444,
      total_tokens_cache_creation: 5555,
      total_tracked_cost_usd: 66.66,
    });

    store.writeRun(entry, []);

    const db = store["db"];
    const row = db.prepare(
      `SELECT total_llm_duration_ms, total_tokens_prompt, total_tokens_completion,
              total_tokens_cache_read, total_tokens_cache_creation, total_tracked_cost_usd
       FROM eval_runs WHERE run_id = ?`,
    ).get<{
      total_llm_duration_ms: number;
      total_tokens_prompt: number;
      total_tokens_completion: number;
      total_tokens_cache_read: number;
      total_tokens_cache_creation: number;
      total_tracked_cost_usd: number;
    }>("sentinel-agg-run");

    assertEquals(row?.total_llm_duration_ms, 1111);
    assertEquals(row?.total_tokens_prompt, 2222);
    assertEquals(row?.total_tokens_completion, 3333);
    assertEquals(row?.total_tokens_cache_read, 4444);
    assertEquals(row?.total_tokens_cache_creation, 5555);
    assertEquals(row?.total_tracked_cost_usd, 66.66);
  } finally {
    store.close();
  }
});
