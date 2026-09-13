/**
 * @module MemoryReportViewTest
 * @path apps/exactl/tests/memory_report_view_test.ts
 * @description Phase 148 Step 6 — RED-first tests for `exactl eval report --view memory`:
 * per (ability, provider) — run count, passed count, mean score, and report-derived
 * tokens/ms per query (Step 5's `computeTokensPerQuery`/`computeMsPerQuery`, treating
 * each run in the group as one query — this corpus's fixtures are one-query-per-task).
 * Also covers the pure `computeMemoryAbilityRows` aggregation directly and
 * `--format json`.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, tests/scenario_framework/runner/memory_efficiency.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { computeMemoryAbilityRows, computeMemoryMetricRows, EvalCommands } from "../src/commands/eval_commands.ts";
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

function seedMemoryRun(
  store: EvalSqliteStore,
  overrides: {
    runId: string;
    ability: string;
    provider: string;
    score: number;
    passed: boolean;
    tokensPrompt?: number;
    tokensCompletion?: number;
    durationMs?: number;
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: `memory-${overrides.ability}-basic`,
    pack: "memory",
    tags: ["domain", "subsystem:memory", `ability:${overrides.ability}`],
    outcome: overrides.passed ? "success" : "failure",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.score,
    passed: overrides.passed,
    timestamp: new Date().toISOString(),
    provider: overrides.provider,
    total_tokens_prompt: overrides.tokensPrompt,
    total_tokens_completion: overrides.tokensCompletion,
    duration_ms: overrides.durationMs,
  }, []);
}

function seedMemoryMetricRun(
  store: EvalSqliteStore,
  overrides: { runId: string; metric: string; provider: string; score: number; passed: boolean },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: `memory-${overrides.metric}-basic`,
    pack: "memory",
    tags: ["domain", "subsystem:memory", `metric:${overrides.metric}`],
    outcome: overrides.passed ? "success" : "failure",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.score,
    passed: overrides.passed,
    timestamp: new Date().toISOString(),
    provider: overrides.provider,
  }, []);
}

Deno.test("[MemoryAbilityRows] groups runs by (ability, provider), computing mean score and pass count", () => {
  const rows = computeMemoryAbilityRows([
    { tags: JSON.stringify(["ability:information-extraction"]), provider: "claude-cli", suite_score: 1, passed: 1 },
    { tags: JSON.stringify(["ability:information-extraction"]), provider: "claude-cli", suite_score: 0.5, passed: 0 },
    { tags: JSON.stringify(["ability:abstention"]), provider: "claude-cli", suite_score: 1, passed: 1 },
  ]);

  const infoRow = rows.find((r) => r.ability === "information-extraction");
  assertEquals(infoRow?.runCount, 2);
  assertEquals(infoRow?.passedCount, 1);
  assertEquals(infoRow?.meanScore, 0.75);

  const abstentionRow = rows.find((r) => r.ability === "abstention");
  assertEquals(abstentionRow?.runCount, 1);
});

Deno.test("[MemoryAbilityRows] a run with no ability: tag is excluded from the report", () => {
  const rows = computeMemoryAbilityRows([
    { tags: JSON.stringify(["domain"]), provider: "claude-cli", suite_score: 1, passed: 1 },
  ]);
  assertEquals(rows.length, 0);
});

Deno.test("[MemoryMetricRows] groups runs by (metric, provider) for signals outside the ability taxonomy", () => {
  const rows = computeMemoryMetricRows([
    { tags: JSON.stringify(["metric:consolidation-quality"]), provider: "claude-cli", suite_score: 1, passed: 1 },
    { tags: JSON.stringify(["metric:consolidation-quality"]), provider: "claude-cli", suite_score: 0.5, passed: 0 },
    { tags: JSON.stringify(["ability:abstention"]), provider: "claude-cli", suite_score: 1, passed: 1 },
  ]);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metric, "consolidation-quality");
  assertEquals(rows[0].runCount, 2);
  assertEquals(rows[0].passedCount, 1);
  assertEquals(rows[0].meanScore, 0.75);
});

Deno.test("[EvalReportMemoryView] renders per-ability/provider score, pass count, and derived tokens/ms per query", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  seedMemoryRun(store, {
    runId: "run-1",
    ability: "information-extraction",
    provider: "claude-cli",
    score: 1,
    passed: true,
    tokensPrompt: 800,
    tokensCompletion: 200,
    durationMs: 500,
  });
  seedMemoryRun(store, {
    runId: "run-2",
    ability: "abstention",
    provider: "claude-cli",
    score: 1,
    passed: true,
  });

  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "memory", dbPath }));
  const text = output.join("\n");

  assertStringIncludes(text, "information-extraction");
  assertStringIncludes(text, "abstention");
  assertStringIncludes(text, "1.000", "mean score must render with 3 decimals");
  // tokens_per_query = (800 + 200) / 1 run = 1000; ms_per_query = 500 / 1 run = 500.
  assertStringIncludes(text, "1000", "tokens-per-query must render for the ability with token data");
  assertStringIncludes(text, "500", "ms-per-query must render for the ability with duration data");
  assertStringIncludes(text, "—", "the abstention row (no token/duration data) must render — for efficiency");
  await cleanup();
});

Deno.test("[EvalReportMemoryView] also renders consolidation/learning-effectiveness metric rows below the ability table", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  seedMemoryRun(store, {
    runId: "run-1",
    ability: "information-extraction",
    provider: "claude-cli",
    score: 1,
    passed: true,
  });
  seedMemoryMetricRun(store, {
    runId: "run-2",
    metric: "consolidation-quality",
    provider: "claude-cli",
    score: 1,
    passed: true,
  });

  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "memory", dbPath }));
  const text = output.join("\n");

  assertStringIncludes(text, "Per Ability");
  assertStringIncludes(text, "Consolidation & Learning-Effectiveness");
  assertStringIncludes(text, "consolidation-quality");
  await cleanup();
});

Deno.test("[EvalReportMemoryView] --format json renders machine-readable per-ability rows", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  seedMemoryRun(store, {
    runId: "run-1",
    ability: "information-extraction",
    provider: "claude-cli",
    score: 1,
    passed: true,
  });
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "memory", dbPath, format: "json" }));
  const parsed = JSON.parse(output.join("\n"));

  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed[0].ability, "information-extraction");
  await cleanup();
});

Deno.test("[EvalReportMemoryView] no memory-tagged history reports cleanly, not an error", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "memory", dbPath }));
  assertStringIncludes(output.join("\n"), "No memory");
  await cleanup();
});
