/**
 * @module EvalReportExternalViewTest
 * @path apps/exactl/tests/eval_report_external_view_test.ts
 * @description Phase 144 Step 4 — RED-first test for `exactl eval report --view external`:
 *   per (benchmark, version, cell) comparability rows — outcome-channel resolved rate over the
 *   tasks run (denominator never silently partial, stated next to the manifest's supported
 *   subset size), coverage, mean tracked cost (total_tracked_cost_usd runs only), run date,
 *   and harness+model identifiers — plus the single-sourced caveat block, and `--format json`
 *   for trend jobs.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, packages/eval-history/src/history_sqlite.ts, packages/eval-history/src/external_benchmark.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore, EXTERNAL_BENCHMARK_CAVEAT } from "@exaix/eval-history";
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

const BENCHMARK = "terminal-bench";
const BENCHMARK_VERSION = "v1";

function seedExternalRun(
  store: EvalSqliteStore,
  overrides: {
    runId: string;
    scenarioId: string;
    cellId: string;
    provider: string;
    model: string;
    passed: boolean;
    costUsd?: number;
    timestamp?: string;
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    pack: "external_terminal_bench",
    outcome: overrides.passed ? "success" : "failure",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.passed ? 1 : 0,
    passed: overrides.passed,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: overrides.provider,
    model: overrides.model,
    total_tracked_cost_usd: overrides.costUsd,
    benchmark: BENCHMARK,
    benchmark_version: BENCHMARK_VERSION,
  }, []);
}

function writeManifest(dir: string, supportedCount: number): string {
  const path = join(dir, "manifest.json");
  Deno.writeTextFileSync(
    path,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      benchmark_version: BENCHMARK_VERSION,
      total_tasks: supportedCount + 4,
      supported_count: supportedCount,
      coverage_pct: (supportedCount / (supportedCount + 4)) * 100,
      tasks: [],
    }),
  );
  return path;
}

Deno.test("[EvalReportExternalView] renders per-cell comparability with explicit resolved-rate denominator and caveat", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  // Cell A: 5 tasks run (4 resolved), manifest declares 12 supported → 42% coverage.
  const cellARuns: Array<{ id: string; passed: boolean; cost?: number }> = [
    { id: "t1", passed: true, cost: 0.02 },
    { id: "t2", passed: true, cost: 0.03 },
    { id: "t3", passed: true, cost: 0.02 },
    { id: "t4", passed: true, cost: 0.05 },
    { id: "t5", passed: false, cost: 0.04 },
  ];
  for (const run of cellARuns) {
    seedExternalRun(store, {
      runId: `run-a-${run.id}`,
      scenarioId: run.id,
      cellId: "cell-a",
      provider: "anthropic",
      model: "claude-sonnet",
      passed: run.passed,
      costUsd: run.cost,
      timestamp: `2026-01-0${run.id.replace("t", "")}T00:00:00.000Z`,
    });
  }
  // Cell B: partial subset — 2 of 12 supported tasks, 1 resolved, no cost data.
  seedExternalRun(store, {
    runId: "run-b-t6",
    scenarioId: "t6",
    cellId: "cell-b",
    provider: "openai",
    model: "gpt-5",
    passed: true,
    timestamp: "2026-02-10T00:00:00.000Z",
  });
  seedExternalRun(store, {
    runId: "run-b-t7",
    scenarioId: "t7",
    cellId: "cell-b",
    provider: "openai",
    model: "gpt-5",
    passed: false,
    timestamp: "2026-02-11T00:00:00.000Z",
  });

  store.close();

  const manifestPath = writeManifest(tempDir, 12);
  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() =>
    cmds.report({ view: "external", dbPath, externalManifestPath: manifestPath })
  );
  const text = output.join("\n");

  assertStringIncludes(text, "External Benchmark Comparability", "view title must render");
  assertStringIncludes(text, "terminal-bench", "benchmark identifier must render");
  assertStringIncludes(text, BENCHMARK_VERSION, "benchmark version must render");
  // Cell A: 4/5 resolved with explicit denominator, 42% coverage of the 12-task subset.
  assertStringIncludes(text, "4/5", "resolved-rate denominator (tasks run) must be explicit");
  assertStringIncludes(text, "80%", "cell A resolved rate must render");
  assertStringIncludes(text, "12", "supported-subset size must render next to tasks run");
  assertStringIncludes(text, "42%", "coverage must render as tasks-run over subset size");
  assertStringIncludes(text, "0.0320", "mean cost (0.16/5) must render with 4 decimals");
  assertStringIncludes(text, "2026-01-05", "latest run date must render");
  assertStringIncludes(text, "claude-sonnet", "harness+model identifier must render");
  // Cell B: 1/2 resolved, cost absent → — (never 0).
  assertStringIncludes(text, "1/2", "cell B denominator must be its own tasks run");
  assertStringIncludes(text, "cell-b", "cell B must render");
  assertStringIncludes(text, EXTERNAL_BENCHMARK_CAVEAT.slice(0, 40), "single-sourced caveat must render");
  await cleanup();
});

Deno.test("[EvalReportExternalView] --format json renders rows plus caveat for trend jobs", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  seedExternalRun(store, {
    runId: "run-a-t1",
    scenarioId: "t1",
    cellId: "cell-a",
    provider: "anthropic",
    model: "claude-sonnet",
    passed: true,
    costUsd: 0.05,
  });
  store.close();

  const manifestPath = writeManifest(tempDir, 12);
  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() =>
    cmds.report({ view: "external", format: "json", dbPath, externalManifestPath: manifestPath })
  );
  const parsed = JSON.parse(output.join("\n")) as {
    caveat: string;
    rows: Array<{
      benchmark: string;
      benchmarkVersion: string;
      tasksRun: number;
      resolvedCount: number;
      resolvedRate: number;
      subsetSize: number;
      meanCostUsd: number;
    }>;
  };
  assertEquals(parsed.caveat, EXTERNAL_BENCHMARK_CAVEAT, "json must carry the single-sourced caveat");
  assertEquals(parsed.rows.length, 1, "one external row in json");
  assertEquals(parsed.rows[0].benchmark, BENCHMARK);
  assertEquals(parsed.rows[0].tasksRun, 1);
  assertEquals(parsed.rows[0].resolvedRate, 1);
  assertEquals(parsed.rows[0].subsetSize, 12, "subset size must come from the manifest");
  assertEquals(parsed.rows[0].meanCostUsd, 0.05);
  await cleanup();
});

Deno.test("[EvalReportExternalView] empty history prints a message", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "external", dbPath }));
  assertStringIncludes(output.join("\n"), "No external-benchmark runs found in history.");
  await cleanup();
});
