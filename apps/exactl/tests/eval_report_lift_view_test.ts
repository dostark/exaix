/**
 * @module EvalReportLiftViewTest
 * @path apps/exactl/tests/eval_report_lift_view_test.ts
 * @description Phase 143 Step 1 — RED-first test. `exactl eval report --view lift` must render
 * per-family harness lift as `meanDelta` / `stdevDelta` / `noEffect` with an explicit basis
 * (cells, run ids, task count) from seeded history runs — never a bare point delta. The view
 * spawns `scripts/run_harness_lift_report.ts` (the `eval run` bridge pattern — the paired-
 * comparison engine lives in the Test layer and is consumed from scripts, never imported into
 * production), so this test exercises the full CLI → script → store → engine path.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, scripts/run_harness_lift_report.ts, tests/scenario_framework/runner/harness_lift.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";
import { EvalScoringMode } from "@exaix/core";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { VERIFY_TESTS_STEP_ID } from "../../../tests/scenario_framework/runner/scenario_templates.ts";

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
    tags?: string[];
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    pack: "swe_tasks",
    tags: overrides.tags ?? ["task:bug-fix"],
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.score,
    passed: true,
    timestamp: new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: overrides.provider,
    model: overrides.model,
  }, [{ stepId: VERIFY_TESTS_STEP_ID, score: overrides.score }]);
}

Deno.test("[EvalReportLiftView] renders per-family meanDelta/stdevDelta/noEffect with basis from seeded runs", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  // Seed with an explicit path before any chdir: the deno test runner (DENO_JOBS) shares one
  // process cwd across parallel test files, so cwd-dependent resolution must never back the
  // seed. The report() call below is the only cwd-sensitive step, and it is bracketed tightly.
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  // Matched pair T1: Exaix 0.8 vs bare 0.6 → delta +0.2
  seedRun(store, {
    runId: "run-e1",
    scenarioId: "fix-bug-null-guard",
    cellId: "claude-code-anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    score: 0.8,
  });
  seedRun(store, {
    runId: "run-b1",
    scenarioId: "fix-bug-null-guard",
    cellId: "bare/claude-code/anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    score: 0.6,
  });
  // Matched pair T2: Exaix 0.9 vs bare 0.5 → delta +0.4 → meanDelta +0.300, stdevDelta 0.100
  seedRun(store, {
    runId: "run-e2",
    scenarioId: "fix-bug-typo-route",
    cellId: "claude-code-anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    score: 0.9,
  });
  seedRun(store, {
    runId: "run-b2",
    scenarioId: "fix-bug-typo-route",
    cellId: "bare/claude-code/anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    score: 0.5,
  });
  // Unmatched T3: Exaix only → excluded with a warning
  seedRun(store, {
    runId: "run-e3",
    scenarioId: "fix-bug-unmatched",
    cellId: "claude-code-anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    score: 0.9,
  });
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "lift", dbPath }));

  const text = output.join("\n");
  assertStringIncludes(text, "task:bug-fix", "family name must be rendered");
  assertStringIncludes(text, "+0.300", "meanDelta must render with sign and 3 decimals");
  assertStringIncludes(text, "0.100", "stdevDelta must render");
  assertStringIncludes(text, "effect", "|meanDelta| >= stdevDelta → effect verdict");
  assertStringIncludes(text, "bare/claude-code/anthropic", "control cell basis must be named");
  assertStringIncludes(text, "claude-code-anthropic", "treatment cell basis must be named");
  assertStringIncludes(text, "run-e1", "treatment basis run ids must be listed");
  assertStringIncludes(text, "run-b1", "control basis run ids must be listed");
  assertStringIncludes(text, "2", "task count must render");
  assertStringIncludes(text, "unmatched", "unmatched exclusion must be surfaced as a warning");
  await cleanup();
});

Deno.test("[EvalReportLiftView] empty history renders the no-history notice, not a crash", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "lift", dbPath }));
  const text = output.join("\n");
  assert(
    text.length > 0 && !text.includes("Error"),
    `must render a notice, got: ${text}`,
  );
  await cleanup();
});
