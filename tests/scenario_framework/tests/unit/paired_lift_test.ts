/**
 * @module PairedLiftTest
 * @path tests/scenario_framework/tests/unit/paired_lift_test.ts
 * @description Phase 143 Step 1 — RED-first tests. `computeHarnessLift` (harness_lift.ts)
 * builds `ArmKind.HARNESS_ABLATION` paired comparisons over a seeded eval-history store via
 * `queryOutcomeRuns`: per-task control (bare cell) vs treatment (Exaix cell) outcome-channel
 * scores from the latest run set, matched on (task, tool, provider, model). Unmatched tasks
 * (only one side present) are excluded with a warning count. `noEffect` is asserted where
 * |meanDelta| < stdevDelta (Phase 158 measurement contract), and `validatePreregistration`
 * rejects post-hoc task cherry-picking.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/harness_lift.ts, tests/scenario_framework/runner/arm_comparison.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { computeHarnessLift } from "../../runner/harness_lift.ts";
import { ArmKind, ComparisonMetric, type IArmComparisonSpec } from "../../runner/arm_comparison.ts";
import { VERIFY_TESTS_STEP_ID } from "../../runner/scenario_templates.ts";

const OUTCOME_STEP_IDS = [VERIFY_TESTS_STEP_ID];

interface ISeedRunOptions {
  runId: string;
  scenarioId: string;
  cellId: string;
  provider: string;
  model: string;
  score: number;
  timestamp: string;
  tags?: string[];
}

function seedRun(store: EvalSqliteStore, o: ISeedRunOptions): void {
  store.writeRun({
    run_id: o.runId,
    scenario_id: o.scenarioId,
    pack: "swe_tasks",
    tags: o.tags ?? ["task:bug-fix"],
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: o.score,
    passed: true,
    timestamp: o.timestamp,
    cell_id: o.cellId,
    provider: o.provider,
    model: o.model,
  }, [{ stepId: VERIFY_TESTS_STEP_ID, score: o.score }]);
}

function openStore(): { store: EvalSqliteStore; cleanup: () => void } {
  const dir = Deno.makeTempDirSync();
  const store = new EvalSqliteStore(`${dir}/eval.db`);
  store.initialize();
  return {
    store,
    cleanup: () => {
      store.close();
      Deno.removeSync(dir, { recursive: true });
    },
  };
}

const T1 = "fix-bug-null-guard-cli";
const T2 = "fix-bug-typo-route-handler";
const T3 = "fix-bug-unmatched-task";

const EXAIX_CELL = "claude-code-anthropic";
const BARE_CELL = "bare/claude-code/anthropic";

Deno.test("[PairedLift] computes meanDelta/stdevDelta over matched tasks, excluding unmatched with a warning", () => {
  const { store, cleanup } = openStore();
  try {
    seedRun(store, {
      runId: "e1",
      scenarioId: T1,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.8,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "b1",
      scenarioId: T1,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.6,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "e2",
      scenarioId: T2,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.9,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "b2",
      scenarioId: T2,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.5,
      timestamp: "2026-08-01T00:00:00Z",
    });
    // Unmatched: Exaix run only — must be excluded, not scored as a bare-zero.
    seedRun(store, {
      runId: "e3",
      scenarioId: T3,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.9,
      timestamp: "2026-08-01T00:00:00Z",
    });

    const rows = store.queryOutcomeRuns({ outcomeStepIds: OUTCOME_STEP_IDS });
    const report = computeHarnessLift(rows);

    assertEquals(report.unmatchedWarningCount, 1, "T3 must be excluded with a warning");
    assertEquals(report.families.length, 1);
    const family = report.families[0];
    assertEquals(family.family, "task:bug-fix");
    assertEquals(family.taskCount, 2);
    // deltas: T1 0.8-0.6=0.2, T2 0.9-0.5=0.4 → mean 0.3, population stdev 0.1
    assertAlmostEquals(family.comparison.meanDelta, 0.3);
    assertAlmostEquals(family.comparison.stdevDelta, 0.1);
    assertEquals(family.comparison.noEffect, false, "|0.3| < 0.1 is false — an effect");
    assertEquals(family.comparison.armId, "harness-lift");
    assertEquals(family.comparison.metric, ComparisonMetric.OBJECTIVE_OUTCOME);
    assertEquals(
      family.basis.controlRunIds.sort(),
      ["b1", "b2"].sort(),
      "basis must name the bare control run ids",
    );
    assertEquals(
      family.basis.treatmentRunIds.sort(),
      ["e1", "e2"].sort(),
      "basis must name the Exaix treatment run ids",
    );
    assertEquals(family.basis.controlCell, BARE_CELL);
    assertEquals(family.basis.treatmentCell, EXAIX_CELL);
    assert(
      family.basis.unmatchedTaskIds.includes(T3),
      "basis must name the unmatched task",
    );
  } finally {
    cleanup();
  }
});

Deno.test("[PairedLift] noEffect verdict is true when |meanDelta| < stdevDelta", () => {
  const { store, cleanup } = openStore();
  try {
    seedRun(store, {
      runId: "e1",
      scenarioId: T1,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.85,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "b1",
      scenarioId: T1,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.8,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "e2",
      scenarioId: T2,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.75,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "b2",
      scenarioId: T2,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.8,
      timestamp: "2026-08-01T00:00:00Z",
    });

    const rows = store.queryOutcomeRuns({ outcomeStepIds: OUTCOME_STEP_IDS });
    const report = computeHarnessLift(rows);

    assertAlmostEquals(report.families[0].comparison.meanDelta, 0, 1e-9, "deltas +0.05 and -0.05 cancel");
    assertAlmostEquals(report.families[0].comparison.stdevDelta, 0.05, 1e-9);
    assertEquals(report.families[0].comparison.noEffect, true, "|0| < 0.05 — no effect");
  } finally {
    cleanup();
  }
});

Deno.test("[PairedLift] the latest run set wins per cell when a task was run twice", () => {
  const { store, cleanup } = openStore();
  try {
    seedRun(store, {
      runId: "e-old",
      scenarioId: T1,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.3,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "e-new",
      scenarioId: T1,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.9,
      timestamp: "2026-08-02T00:00:00Z",
    });
    seedRun(store, {
      runId: "b1",
      scenarioId: T1,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.6,
      timestamp: "2026-08-01T00:00:00Z",
    });

    const rows = store.queryOutcomeRuns({ outcomeStepIds: OUTCOME_STEP_IDS });
    const report = computeHarnessLift(rows);

    assertEquals(report.families[0].taskCount, 1);
    assertEquals(report.families[0].comparison.perTask[0].treatmentMetrics.mean, 0.9, "latest Exaix run must win");
    assertAlmostEquals(report.families[0].comparison.meanDelta, 0.3);
  } finally {
    cleanup();
  }
});

Deno.test("[PairedLift] validatePreregistration guards the task subset", () => {
  const { store, cleanup } = openStore();
  try {
    seedRun(store, {
      runId: "e1",
      scenarioId: T1,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.8,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "b1",
      scenarioId: T1,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.6,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "e2",
      scenarioId: T2,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.9,
      timestamp: "2026-08-01T00:00:00Z",
    });
    seedRun(store, {
      runId: "b2",
      scenarioId: T2,
      cellId: BARE_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.5,
      timestamp: "2026-08-01T00:00:00Z",
    });

    const rows = store.queryOutcomeRuns({ outcomeStepIds: OUTCOME_STEP_IDS });

    const declared: IArmComparisonSpec = {
      armId: "harness-lift",
      kind: ArmKind.HARNESS_ABLATION,
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      control: { description: "bare baseline" },
      treatment: { description: "Exaix cell" },
      taskIds: [T1, T2],
      trials: 1,
      registeredAt: "2026-08-01T00:00:00Z",
    };

    const guarded = computeHarnessLift(rows, { preregistered: declared });
    assertEquals(guarded.families[0].taskCount, 2, "declared subset passes the guard");

    const undeclared: IArmComparisonSpec = {
      ...declared,
      taskIds: [T1],
    };
    assertThrows(
      () => computeHarnessLift(rows, { preregistered: undeclared }),
      /Pre-registration violation/,
      "a task outside the declared set must be rejected",
    );
  } finally {
    cleanup();
  }
});

Deno.test("[PairedLift] runs without outcome scores contribute no match", () => {
  const { store, cleanup } = openStore();
  try {
    seedRun(store, {
      runId: "e1",
      scenarioId: T1,
      cellId: EXAIX_CELL,
      provider: "anthropic",
      model: "m1",
      score: 0.8,
      timestamp: "2026-08-01T00:00:00Z",
    });
    store.writeRun({
      run_id: "b-no-outcome",
      scenario_id: T1,
      pack: "swe_tasks",
      tags: ["task:bug-fix"],
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 0.6,
      passed: true,
      timestamp: "2026-08-01T00:00:00Z",
      cell_id: BARE_CELL,
      provider: "anthropic",
      model: "m1",
    }, []);

    const rows = store.queryOutcomeRuns({ outcomeStepIds: OUTCOME_STEP_IDS });
    const report = computeHarnessLift(rows);

    assertEquals(report.unmatchedWarningCount, 1, "bare run without an outcome score must be unmatched");
    assertEquals(report.families.length, 0, "no matched pair → no family comparison");
  } finally {
    cleanup();
  }
});

function assertThrows(fn: () => unknown, pattern: RegExp, message: string): void {
  let threw: Error | undefined;
  try {
    fn();
  } catch (error) {
    threw = error instanceof Error ? error : new Error(String(error));
  }
  assert(threw !== undefined, message);
  assert(pattern.test(threw.message), `${message} — got: ${threw.message}`);
}
