/**
 * @module EvalReportRobustnessViewTest
 * @path apps/exactl/tests/eval_report_robustness_view_test.ts
 * @description Phase 145 Step 1 — RED-first test for `exactl eval report --view robustness`:
 *   the AgentDojo triple (clean_utility, utility_under_attack, attack_success_rate,
 *   robustness_gap) per vector/family, computed from matched clean/attacked twin runs tagged
 *   `vector:<name>` / `attack:clean` / `attack:attacked`. `attack_success_rate` is precise only
 *   under `scoring: gated` (a fired `class: security` objective zeroes `suite_score` via
 *   `composeGated()` — see `tests/scenario_framework/runner/scoring.ts`); a vector/family group
 *   with only one side of the pair is excluded with a warning, not silently half-reported.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, tests/scenario_framework/runner/scoring.ts]
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

function seedAdversarialRun(
  store: EvalSqliteStore,
  overrides: {
    runId: string;
    scenarioId: string;
    vector: string;
    family: string;
    side: "clean" | "attacked";
    score: number;
    scoringMode?: EvalScoringMode;
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    pack: "adversarial",
    tags: ["adversarial", `vector:${overrides.vector}`, overrides.family, `attack:${overrides.side}`],
    outcome: overrides.score > 0 ? "success" : "failure",
    mode: "auto",
    scoring_mode: overrides.scoringMode ?? EvalScoringMode.GATED,
    suite_score: overrides.score,
    passed: overrides.score >= 0.5,
    timestamp: new Date().toISOString(),
  }, []);
}

Deno.test("[EvalReportRobustnessView] computeRobustnessRows: matched pair yields the AgentDojo triple", () => {
  const rows = computeRobustnessRows(
    [
      {
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:clean"]),
        suite_score: 1.0,
        scoring_mode: "gated",
      },
      {
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:attacked"]),
        suite_score: 0.6,
        scoring_mode: "gated",
      },
      {
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:attacked"]),
        suite_score: 0.0,
        scoring_mode: "gated",
      },
    ],
    {},
  );
  assertEquals(rows.length, 1);
  const row = rows[0];
  assertEquals(row.vector, "portal-readme");
  assertEquals(row.family, "task:bug-fix");
  assertEquals(row.matched, true);
  assertEquals(row.cleanUtility, 1.0);
  assertEquals(row.utilityUnderAttack, 0.3);
  // One of two attacked (gated) runs scored 0 → attack fired on that run.
  assertEquals(row.attackSuccessRate, 0.5);
  assertEquals(row.robustnessGap, 0.7);
});

Deno.test("[EvalReportRobustnessView] an unmatched vector/family (attacked only) is excluded with matched:false", () => {
  const rows = computeRobustnessRows(
    [
      {
        tags: JSON.stringify(["adversarial", "vector:filename", "task:bug-fix", "attack:attacked"]),
        suite_score: 0.0,
        scoring_mode: "gated",
      },
    ],
    {},
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].matched, false);
  assertEquals(rows[0].cleanUtility, undefined);
  assertEquals(rows[0].attackSuccessRate, undefined);
});

Deno.test("[EvalReportRobustnessView] additive-scoring attacked runs don't count toward attack_success_rate", () => {
  const rows = computeRobustnessRows(
    [
      {
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:clean"]),
        suite_score: 1.0,
        scoring_mode: "additive",
      },
      {
        tags: JSON.stringify(["adversarial", "vector:portal-readme", "task:bug-fix", "attack:attacked"]),
        suite_score: 0.0,
        scoring_mode: "additive",
      },
    ],
    {},
  );
  assertEquals(rows[0].attackSuccessRate, undefined, "additive-scoring runs carry no gated zero-signal");
});

Deno.test("[EvalReportRobustnessView] --view robustness renders the triple per vector/family", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  seedAdversarialRun(store, {
    runId: "run-clean",
    scenarioId: "leak-canary-clean",
    vector: "portal-readme",
    family: "task:bug-fix",
    side: "clean",
    score: 1.0,
  });
  seedAdversarialRun(store, {
    runId: "run-attacked",
    scenarioId: "leak-canary-attacked",
    vector: "portal-readme",
    family: "task:bug-fix",
    side: "attacked",
    score: 0.0,
  });
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "robustness", dbPath }));
  const text = output.join("\n");

  assertStringIncludes(text, "portal-readme");
  assertStringIncludes(text, "task:bug-fix");
  assertStringIncludes(text, "1.000", "clean_utility must render");
  assertStringIncludes(text, "0.000", "utility_under_attack must render");
  await cleanup();
});
