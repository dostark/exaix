/**
 * @module EvalReportInteractiveViewTest
 * @path apps/exactl/tests/eval_report_interactive_view_test.ts
 * @description Phase 145 Step 4 — RED-first test for `exactl eval report --view interactive`:
 *   per-persona rounds-to-converge, non-convergence rate, policy-adherence rate, and pass^k
 *   (reusing Phase 140's `pass_pow_k` column), grouped by `persona:<name>` /
 *   `rounds:<N>` / `converged:true|false` / `adherent:true|false` tags — `eval_runs.metadata`
 *   is hardcoded to null in `EvalSqliteStore.writeRun` today (no entry field feeds it), so tags
 *   are this pack's extensibility mechanism, exactly as Step 1 used `vector:`/`attack:` tags.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, tests/scenario_framework/runner/policy_adherence.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { computeInteractiveRows, EvalCommands } from "../src/commands/eval_commands.ts";
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

function interactiveTags(persona: string, rounds: number, converged: boolean, adherent: boolean): string[] {
  return ["interactive", `persona:${persona}`, `rounds:${rounds}`, `converged:${converged}`, `adherent:${adherent}`];
}

Deno.test("[EvalReportInteractiveView] computeInteractiveRows: aggregates convergence/adherence/pass^k per persona", () => {
  const rows = computeInteractiveRows([
    { tags: JSON.stringify(interactiveTags("cooperative", 2, true, true)), pass_pow_k: 1.0 },
    { tags: JSON.stringify(interactiveTags("cooperative", 4, true, true)), pass_pow_k: 0.8 },
    { tags: JSON.stringify(interactiveTags("adversarial", 5, false, false)), pass_pow_k: 0.5 },
  ]);

  const cooperative = rows.find((r) => r.persona === "cooperative")!;
  assertEquals(cooperative.runCount, 2);
  assertEquals(cooperative.meanRoundsToConverge, 3);
  assertEquals(cooperative.nonConvergenceRate, 0);
  assertEquals(cooperative.policyAdherenceRate, 1);
  assertEquals(cooperative.meanPassPowK, 0.9);

  const adversarial = rows.find((r) => r.persona === "adversarial")!;
  assertEquals(adversarial.runCount, 1);
  assertEquals(adversarial.nonConvergenceRate, 1);
  assertEquals(adversarial.policyAdherenceRate, 0);
});

Deno.test("[EvalReportInteractiveView] runs with no persona tag or malformed tags are excluded, not crashed on", () => {
  const rows = computeInteractiveRows([
    { tags: JSON.stringify(["interactive"]), pass_pow_k: 1.0 },
    { tags: JSON.stringify(["persona:cooperative", "rounds:2", "converged:true", "adherent:true"]), pass_pow_k: null },
    { tags: null, pass_pow_k: null },
    { tags: "not json", pass_pow_k: null },
  ]);
  const cooperative = rows.find((r) => r.persona === "cooperative")!;
  assertEquals(cooperative.runCount, 1);
  assertEquals(cooperative.meanRoundsToConverge, 2);
  assertEquals(cooperative.meanPassPowK, undefined);
});

Deno.test("[EvalReportInteractiveView] --view interactive renders per-persona convergence/adherence/pass^k", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  store.writeRun({
    run_id: "run-1",
    scenario_id: "interactive-cooperative",
    pack: "interactive",
    tags: interactiveTags("cooperative", 2, true, true),
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: 1.0,
    passed: true,
    timestamp: new Date().toISOString(),
    pass_pow_k: 1.0,
  }, []);
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "interactive", dbPath }));
  const text = output.join("\n");

  assertStringIncludes(text, "cooperative");
  assertStringIncludes(text, "2.000");
  await cleanup();
});
