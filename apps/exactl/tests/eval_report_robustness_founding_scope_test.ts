/**
 * @module EvalReportRobustnessFoundingScopeTest
 * @path apps/exactl/tests/eval_report_robustness_founding_scope_test.ts
 * @description Phase 145 post-gap remediation Step 7 (GAP-1) — `computeRobustnessRows`'s
 *   `runIds` option scopes the rendered AgentDojo triple to an explicit run-id allowlist, so a
 *   documented founding table can be regenerated exactly regardless of how much further local
 *   run history has accumulated in the shared `.exa/eval.db` by the time it's re-run.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { computeRobustnessRows, EvalCommands } from "../src/commands/eval_commands.ts";
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

Deno.test("[EvalReportRobustnessFoundingScope] runIds allowlist excludes runs added after the founding set", () => {
  const rows = computeRobustnessRows(
    [
      {
        run_id: "founding-clean",
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:clean"]),
        suite_score: 1.0,
        scoring_mode: "gated",
      },
      {
        run_id: "founding-attacked",
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:attacked"]),
        suite_score: 1.0,
        scoring_mode: "gated",
      },
      // A later, unrelated attacked run that would otherwise pull utility_under_attack down —
      // must be excluded from the founding table when runIds scoping is applied.
      {
        run_id: "later-debug-attempt",
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:attacked"]),
        suite_score: 0.0,
        scoring_mode: "gated",
      },
    ],
    { runIds: ["founding-clean", "founding-attacked"] },
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].cleanUtility, 1.0);
  assertEquals(rows[0].utilityUnderAttack, 1.0, "the later noise run must not be included in the scoped mean");
  assertEquals(rows[0].attackSuccessRate, 0.0);
});

Deno.test("[EvalReportRobustnessFoundingScope] omitting runIds keeps prior unscoped behavior unchanged", () => {
  const runs = [
    {
      run_id: "a",
      tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:clean"]),
      suite_score: 1.0,
      scoring_mode: "gated",
    },
    {
      run_id: "b",
      tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:attacked"]),
      suite_score: 0.0,
      scoring_mode: "gated",
    },
  ];
  const scoped = computeRobustnessRows(runs, {});
  const unscopedCall = computeRobustnessRows(runs, { vector: undefined, family: undefined });
  assertEquals(scoped, unscopedCall);
  assertEquals(scoped[0].utilityUnderAttack, 0.0);
});

Deno.test("[EvalReportRobustnessFoundingScope] --view robustness --run-ids renders only the scoped runs", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  const seed = (runId: string, side: "clean" | "attacked", score: number) =>
    store.writeRun({
      run_id: runId,
      scenario_id: `leak-canary-${side}`,
      pack: "adversarial",
      tags: ["adversarial", "vector:portal-readme", "task:bug-fix", `attack:${side}`],
      outcome: score > 0 ? "success" : "failure",
      mode: "auto",
      scoring_mode: EvalScoringMode.GATED,
      suite_score: score,
      passed: score >= 0.5,
      timestamp: new Date().toISOString(),
    }, []);
  seed("founding-clean", "clean", 1.0);
  seed("founding-attacked", "attacked", 1.0);
  seed("later-debug-attempt", "attacked", 0.0);
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() =>
    cmds.report({ view: "robustness", dbPath, runIds: ["founding-clean", "founding-attacked"] })
  );
  const text = output.join("\n");
  assertStringIncludes(text, "portal-readme");
  assertStringIncludes(text, "1.000");
  // Unscoped, utility_under_attack would be mean(1.0, 0.0) = 0.500 — its presence would mean
  // the later noise run leaked into the "founding" table despite the runIds allowlist.
  assertEquals(text.includes("0.500"), false, "the later noise run's score must not appear in the scoped table");
  await cleanup();
});
