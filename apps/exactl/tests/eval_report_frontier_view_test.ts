/**
 * @module EvalReportFrontierViewTest
 * @path apps/exactl/tests/eval_report_frontier_view_test.ts
 * @description Phase 143 Step 4 — RED-first test for `exactl eval report --view frontier`:
 *   per-cell (mean score, mean cost, cost_per_solved) with Pareto-dominant cells marked per
 *   the Metric Definitions predicate — A dominates B iff meanScore(A) >= meanScore(B) AND
 *   meanCost(A) <= meanCost(B) with at least one strict inequality; ties are co-dominant;
 *   a cell with no cost data is excluded from dominance entirely and rendered with cost —.
 *   Also asserts `--format json` output.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

function withCapturedOutput<T>(fn: () => T): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));

  const result = fn();
  return Promise.resolve(result)
    .then((resolved) => ({ output, result: resolved }))
    .finally(() => {
      console.log = originalLog;
    });
}

function seedRun(
  store: EvalSqliteStore,
  overrides: {
    runId: string;
    scenarioId: string;
    cellId: string;
    provider: string;
    model: string;
    score: number;
    passed: boolean;
    costUsd?: number;
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    pack: "swe_tasks",
    tags: ["task:bug-fix"],
    outcome: overrides.passed ? "success" : "failure",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.score,
    passed: overrides.passed,
    timestamp: new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: overrides.provider,
    model: overrides.model,
    total_tracked_cost_usd: overrides.costUsd,
  }, []);
}

Deno.test("[EvalReportFrontierView] renders per-cell score/cost/cost-per-solved with Pareto marking", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  const model = "claude-sonnet";
  // Cell A: high score, low cost → dominates B and C.
  seedRun(store, {
    runId: "run-a",
    scenarioId: "t1",
    cellId: "cell-a",
    provider: "p",
    model,
    score: 0.9,
    passed: true,
    costUsd: 0.10,
  });
  // Cell B: lower score, higher cost → dominated by A.
  seedRun(store, {
    runId: "run-b",
    scenarioId: "t1",
    cellId: "cell-b",
    provider: "p",
    model,
    score: 0.7,
    passed: true,
    costUsd: 0.50,
  });
  // Cell C: tied with A (same score, same cost) → co-dominant with A.
  seedRun(store, {
    runId: "run-c",
    scenarioId: "t1",
    cellId: "cell-c",
    provider: "p",
    model,
    score: 0.9,
    passed: true,
    costUsd: 0.10,
  });
  // Cell D: no cost data → excluded from dominance, rendered with cost —.
  seedRun(store, {
    runId: "run-d",
    scenarioId: "t1",
    cellId: "cell-d",
    provider: "p",
    model,
    score: 0.85,
    passed: true,
  });

  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "frontier", dbPath }));
  const text = output.join("\n");

  assertStringIncludes(text, "cell-a", "cell A must render");
  assertStringIncludes(text, "cell-b", "cell B must render");
  assertStringIncludes(text, "cell-c", "cell C must render");
  assertStringIncludes(text, "cell-d", "cell D must render");
  // cost_per_solved: cost / passed count (1 pass each) → 0.10 for A/C, 0.50 for B.
  assertStringIncludes(text, "0.10", "cost-per-solved for cell A must render");
  assertStringIncludes(text, "0.50", "cost-per-solved for cell B must render");
  assertStringIncludes(text, "—", "missing-cost cell must render cost as —");
  assertStringIncludes(text, "0.900", "cell A mean score must render with 3 decimals");
  // Pareto: A and C (co-dominant) are marked; B is dominated; D is excluded (never marked).
  const paretoMarkers = (text.match(/◀ pareto/g) ?? []).length;
  assertStringIncludes(text, "pareto", "Pareto marking must render");
  assertEquals(paretoMarkers, 2, "only the two co-dominant cells (A, C) are Pareto-marked");
  await cleanup();
});

Deno.test("[EvalReportFrontierView] --format json renders machine-readable frontier rows", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  seedRun(store, {
    runId: "run-a",
    scenarioId: "t1",
    cellId: "cell-a",
    provider: "p",
    model: "m",
    score: 0.9,
    passed: true,
    costUsd: 0.10,
  });
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "frontier", format: "json", dbPath }));
  const text = output.join("\n");
  const parsed = JSON.parse(text) as Array<{ cell: string; meanScore: number; meanCost: number }>;
  assertEquals(parsed.length, 1, "one frontier row in json");
  assertEquals(parsed[0].cell, "cell-a");
  assertEquals(parsed[0].meanScore, 0.9, "mean score must render in json");
  assertEquals(parsed[0].meanCost, 0.1, "mean cost must render in json");
  await cleanup();
});
