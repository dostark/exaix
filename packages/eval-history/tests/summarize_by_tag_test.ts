/**
 * @module SummarizeByTagTest
 * @path packages/eval-history/tests/summarize_by_tag_test.ts
 * @description Tests EvalSqliteStore.summarizeByTag — tag-based aggregation
 *   with reconcile rate, per-family scores, and delta computation.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { EvalSqliteStore } from "../src/history_sqlite.ts";
import type { IEvalHistoryEntry } from "../src/history_schema.ts";
import { getDefaultComponentVersions } from "../src/history_schema.ts";

function makeEntry(overrides: Partial<IEvalHistoryEntry> & { run_id: string; scenario_id: string }): IEvalHistoryEntry {
  return {
    pack: "swe_tasks",
    tags: ["swe"],
    suite_score: 0.5,
    passed: false,
    mode: "eval",
    score_threshold: 0.3,
    outcome: "scenario-failure",
    timestamp: new Date().toISOString(),
    trial_scores: [],
    duration_ms: 0,
    trials: 1,
    component_versions: getDefaultComponentVersions(),
    ...overrides,
  };
}

function makeStep(stepIndex: number, hasReview: boolean) {
  return {
    stepId: `step-${stepIndex}`,
    stepIndex,
    score: hasReview ? 1 : 0,
    durationMs: 1000,
    criterionResults: [{
      criterion_id: "review-approved",
      kind: "command-output-contains",
      status: hasReview ? "passed" : "failed",
      score: hasReview ? 1 : 0,
      score_weight: 0.15,
    }],
  };
}

function createStore(): { store: EvalSqliteStore; cleanup: () => void } {
  const path = Deno.makeTempFileSync({ suffix: ".db" });
  const store = new EvalSqliteStore(path);
  store.initialize();
  return {
    store,
    cleanup: () => {
      try {
        Deno.removeSync(path);
      } catch {}
    },
  };
}

Deno.test("[summarizeByTag] returns empty array for no matches", () => {
  const { store, cleanup } = createStore();
  try {
    const result = store.summarizeByTag("nonexistent", {});
    assertEquals(result, []);
  } finally {
    cleanup();
  }
});

Deno.test("[summarizeByTag] groups runs by matching tag prefix", () => {
  const { store, cleanup } = createStore();
  try {
    store.writeRun(
      makeEntry({
        run_id: "r1",
        scenario_id: "s1",
        tags: ["task:feature", "swe"],
        suite_score: 0.95,
        passed: true,
        outcome: "success",
      }),
      [makeStep(13, true)],
    );
    store.writeRun(
      makeEntry({
        run_id: "r2",
        scenario_id: "s2",
        tags: ["task:bug-fix", "swe"],
        suite_score: 0.5,
        passed: false,
        outcome: "scenario-failure",
      }),
      [makeStep(13, false)],
    );

    const result = store.summarizeByTag("task:", {});

    assertEquals(result.length, 2);
    const feature = result.find((r) => r.family === "task:feature");
    const bugfix = result.find((r) => r.family === "task:bug-fix");
    assertEquals(feature?.taskCount, 1);
    assertEquals(feature?.meanScore, 0.95);
    assertEquals(feature?.reconcileRate, 1);
    assertEquals(bugfix?.taskCount, 1);
    assertEquals(bugfix?.meanScore, 0.5);
    assertEquals(bugfix?.reconcileRate, 0);
  } finally {
    cleanup();
  }
});

Deno.test("[summarizeByTag] filters by pack when specified", () => {
  const { store, cleanup } = createStore();
  try {
    store.writeRun(
      makeEntry({
        run_id: "r1",
        scenario_id: "s1",
        pack: "swe_tasks",
        tags: ["task:feature"],
        suite_score: 0.9,
        passed: true,
        outcome: "success",
      }),
      [makeStep(13, true)],
    );
    store.writeRun(
      makeEntry({
        run_id: "r2",
        scenario_id: "s2",
        pack: "other-pack",
        tags: ["task:feature"],
        suite_score: 0.5,
        passed: false,
        outcome: "scenario-failure",
      }),
      [makeStep(13, false)],
    );

    const result = store.summarizeByTag("task:", { pack: "swe_tasks" });
    assertEquals(result.length, 1);
    assertEquals(result[0].taskCount, 1);
  } finally {
    cleanup();
  }
});

Deno.test("[summarizeByTag] latest-per-scenario dedup when lastPerScenario is true", () => {
  const { store, cleanup } = createStore();
  try {
    store.writeRun(
      makeEntry({
        run_id: "r1",
        scenario_id: "s1",
        tags: ["task:feature"],
        suite_score: 0.7,
        passed: true,
        outcome: "success",
        timestamp: "2026-01-01T00:00:00Z",
      }),
      [makeStep(13, true)],
    );
    store.writeRun(
      makeEntry({
        run_id: "r2",
        scenario_id: "s1",
        tags: ["task:feature"],
        suite_score: 0.95,
        passed: true,
        outcome: "success",
        timestamp: "2026-06-01T00:00:00Z",
      }),
      [makeStep(13, true)],
    );

    const result = store.summarizeByTag("task:", { lastPerScenario: true });
    assertEquals(result.length, 1);
    assertEquals(result[0].taskCount, 1);
    assertEquals(result[0].meanScore, 0.95);
  } finally {
    cleanup();
  }
});
