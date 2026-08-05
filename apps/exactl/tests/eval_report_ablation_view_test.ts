/**
 * @module EvalReportAblationViewTest
 * @path apps/exactl/tests/eval_report_ablation_view_test.ts
 * @description Phase 143 Step 2 — RED-first test. `exactl eval report --view ablation`
 *   must render per-family, per-subsystem feature contribution as `meanDelta` /
 *   `stdevDelta` / `noEffect` with an explicit basis (cells, run ids, task count) from
 *   seeded history runs — never a bare mean delta. The view spawns
 *   `scripts/run_ablation_report.ts` (the Step-1 bridge pattern — the contribution
 *   engine lives in the Test layer), so this test exercises the full CLI → script →
 *   store → engine path.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, scripts/run_ablation_report.ts, tests/scenario_framework/runner/ablation_lift.ts]
 */

import { assert, assertStringIncludes } from "@std/assert";
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
    suite_score: overrides.score,
    passed: true,
    timestamp: new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: overrides.provider,
    model: overrides.model,
  }, [{ stepId: VERIFY_TESTS_STEP_ID, score: overrides.score }]);
}

Deno.test("[EvalReportAblationView] renders per-subsystem meanDelta/stdevDelta/noEffect with basis from seeded runs", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  // Seed with an explicit path before any chdir: the deno test runner (DENO_JOBS) shares one
  // process cwd across parallel test files, so cwd-dependent resolution must never back the
  // seed. The report() call below is the only cwd-sensitive step, and it is bracketed tightly.
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  const model = "claude-sonnet-4-5";
  const fullCell = "claude-code-anthropic";
  const ablateSkills = "ablate-skills/claude-code/anthropic";
  const ablateGate = "ablate-quality-gate/claude-code/anthropic";
  const ablatePk = "ablate-portal-knowledge/claude-code/anthropic";

  // T1: full 0.8; skills 0.6 → +0.2; gate 0.7 → +0.1; pk 0.75 → +0.05
  seedRun(store, {
    runId: "run-e1",
    scenarioId: "fix-bug-null-guard",
    cellId: fullCell,
    provider: "anthropic",
    model,
    score: 0.8,
  });
  seedRun(store, {
    runId: "run-s1",
    scenarioId: "fix-bug-null-guard",
    cellId: ablateSkills,
    provider: "anthropic",
    model,
    score: 0.6,
  });
  seedRun(store, {
    runId: "run-g1",
    scenarioId: "fix-bug-null-guard",
    cellId: ablateGate,
    provider: "anthropic",
    model,
    score: 0.7,
  });
  seedRun(store, {
    runId: "run-p1",
    scenarioId: "fix-bug-null-guard",
    cellId: ablatePk,
    provider: "anthropic",
    model,
    score: 0.75,
  });

  // T2: full 0.9; skills 0.5 → +0.4; gate 0.9 → 0.0; pk 0.95 → -0.05
  seedRun(store, {
    runId: "run-e2",
    scenarioId: "fix-bug-typo-route",
    cellId: fullCell,
    provider: "anthropic",
    model,
    score: 0.9,
  });
  seedRun(store, {
    runId: "run-s2",
    scenarioId: "fix-bug-typo-route",
    cellId: ablateSkills,
    provider: "anthropic",
    model,
    score: 0.5,
  });
  seedRun(store, {
    runId: "run-g2",
    scenarioId: "fix-bug-typo-route",
    cellId: ablateGate,
    provider: "anthropic",
    model,
    score: 0.9,
  });
  seedRun(store, {
    runId: "run-p2",
    scenarioId: "fix-bug-typo-route",
    cellId: ablatePk,
    provider: "anthropic",
    model,
    score: 0.95,
  });

  // T3: skills control only — unmatched on every arm, surfaced as a warning.
  seedRun(store, {
    runId: "run-s3",
    scenarioId: "fix-bug-unmatched",
    cellId: ablateSkills,
    provider: "anthropic",
    model,
    score: 0.8,
  });

  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "ablation", dbPath }));

  const text = output.join("\n");
  assertStringIncludes(text, "task:bug-fix", "family name must be rendered");
  // Skills: deltas +0.2/+0.4 → meanDelta +0.300, stdevDelta 0.100 — distinguishable.
  assertStringIncludes(text, "skills", "subsystem must be named");
  assertStringIncludes(text, "+0.300", "skills meanDelta must render with sign and 3 decimals");
  assertStringIncludes(text, "0.100", "skills stdevDelta must render");
  assertStringIncludes(text, "effect", "skills |meanDelta| >= stdevDelta → effect verdict");
  // Portal knowledge: deltas +0.05/-0.05 → meanDelta 0.000, stdevDelta 0.050 → no effect.
  assertStringIncludes(text, "portal-knowledge", "portal-knowledge subsystem must be named");
  assertStringIncludes(text, "no-effect", "indistinguishable subsystem must render the no-effect verdict");
  // Basis: control = ablate cell, treatment = full cell, run ids, task count.
  assertStringIncludes(text, ablateSkills, "control cell basis must be named");
  assertStringIncludes(text, fullCell, "treatment cell basis must be named");
  assertStringIncludes(text, "run-e1", "treatment basis run ids must be listed");
  assertStringIncludes(text, "run-s1", "control basis run ids must be listed");
  assertStringIncludes(text, "2", "task count must render");
  assertStringIncludes(text, "unmatched", "unmatched exclusion must be surfaced as a warning");
  await cleanup();
});

Deno.test("[EvalReportAblationView] empty history renders the no-history notice, not a crash", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "ablation", dbPath }));
  const text = output.join("\n");
  assert(
    text.length > 0 && !text.includes("Error"),
    `must render a notice, got: ${text}`,
  );
  await cleanup();
});
