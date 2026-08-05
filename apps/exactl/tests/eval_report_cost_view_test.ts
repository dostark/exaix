/**
 * @module EvalReportCostViewTest
 * @path apps/exactl/tests/eval_report_cost_view_test.ts
 * @description Phase 140a Step 4 — RED-first tests. `exactl eval report --view cost` must
 * render one row per distinct cell_id/provider/model combination present in history, with
 * correct mean/total math over tracked_cost_usd only. A cell with no tracked cost data (a
 * pure direct-API cell) must render "—", never "0" and never a predicted figure.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { EvalScoringMode } from "@exaix/core";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

function withCapturedOutput<T>(fn: () => T | Promise<T>): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));

  const result = fn();
  const promise = result instanceof Promise ? result : Promise.resolve(result);

  return promise
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
    cellId?: string;
    provider?: string;
    model?: string;
    durationMs?: number;
    totalLlmDurationMs?: number;
    totalTrackedCostUsd?: number;
    totalTokensPrompt?: number;
    totalTokensCompletion?: number;
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: 1.0,
    passed: true,
    timestamp: new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: overrides.provider,
    model: overrides.model,
    duration_ms: overrides.durationMs,
    total_llm_duration_ms: overrides.totalLlmDurationMs,
    total_tracked_cost_usd: overrides.totalTrackedCostUsd,
    total_tokens_prompt: overrides.totalTokensPrompt,
    total_tokens_completion: overrides.totalTokensCompletion,
  }, []);
}

Deno.test("[EvalReportCostView] renders one row per distinct cell_id/provider/model with correct mean/total tracked cost", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  // Explicit db path — never the process-global cwd (shared across `deno test --parallel`
  // worker threads), so seeding and report() always agree regardless of concurrent chdirs.
  const dbPath = join(tempDir, ".exa", "eval.db");
  try {
    const store = new EvalSqliteStore(dbPath);
    store.initialize();
    seedRun(store, {
      runId: "run-a1",
      scenarioId: "report-test",
      cellId: "claude-code-anthropic",
      provider: "anthropic",
      model: "claude-sonnet",
      durationMs: 1000,
      totalLlmDurationMs: 800,
      totalTrackedCostUsd: 0.10,
      totalTokensPrompt: 100,
      totalTokensCompletion: 50,
    });
    seedRun(store, {
      runId: "run-a2",
      scenarioId: "report-test",
      cellId: "claude-code-anthropic",
      provider: "anthropic",
      model: "claude-sonnet",
      durationMs: 2000,
      totalLlmDurationMs: 1200,
      totalTrackedCostUsd: 0.20,
      totalTokensPrompt: 200,
      totalTokensCompletion: 100,
    });
    store.close();

    const cmds = new EvalCommands(context);
    const { output } = await withCapturedOutput(() => cmds.report({ view: "cost", scenario: "report-test", dbPath }));
    const text = output.join("\n");

    assertStringIncludes(text, "claude-code-anthropic");
    // total tracked cost across both runs: 0.10 + 0.20 = 0.30
    assertStringIncludes(text, "0.30");
    // mean duration_ms across both runs: (1000+2000)/2 = 1500
    assertStringIncludes(text, "1500");
  } finally {
    await cleanup();
  }
});

Deno.test("[EvalReportCostView] a cell with no tracked cost data renders — never 0 or a predicted figure", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  try {
    const store = new EvalSqliteStore(dbPath);
    store.initialize();
    seedRun(store, {
      runId: "run-b1",
      scenarioId: "report-test-untracked",
      cellId: "direct-api-openai",
      provider: "openai",
      model: "gpt-5",
      durationMs: 500,
      // No totalTrackedCostUsd at all — a pure direct-API cell.
    });
    store.close();

    const cmds = new EvalCommands(context);
    const { output } = await withCapturedOutput(() =>
      cmds.report({ view: "cost", scenario: "report-test-untracked", dbPath })
    );
    const text = output.join("\n");

    assertStringIncludes(text, "direct-api-openai");
    assertStringIncludes(text, "—");
    assertEquals(/\|\s*0(\.0+)?\s*\|/.test(text), false, "must not render 0 for untracked cost");
  } finally {
    await cleanup();
  }
});

Deno.test("[EvalReportCostView] renders per-cell comparison for at least two matrix cells", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  try {
    const store = new EvalSqliteStore(dbPath);
    store.initialize();
    seedRun(store, {
      runId: "run-c1",
      scenarioId: "multi-cell-test",
      cellId: "claude-code",
      provider: "anthropic",
      model: "claude-sonnet",
      totalTrackedCostUsd: 0.05,
    });
    seedRun(store, {
      runId: "run-c2",
      scenarioId: "multi-cell-test",
      cellId: "opencode",
      provider: "opencode",
      model: "gpt-5-codex",
      totalTrackedCostUsd: 0.03,
    });
    store.close();

    const cmds = new EvalCommands(context);
    const { output } = await withCapturedOutput(() =>
      cmds.report({ view: "cost", scenario: "multi-cell-test", dbPath })
    );
    const text = output.join("\n");

    assertStringIncludes(text, "claude-code");
    assertStringIncludes(text, "opencode");
  } finally {
    await cleanup();
  }
});
