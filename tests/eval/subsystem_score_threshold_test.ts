/**
 * @module SubsystemScoreThresholdTest
 * @path tests/eval/subsystem_score_threshold_test.ts
 * @architectural-layer Test
 * @description Phase 142 Step 25 (GAP-10) — the subsystem score threshold is named, not restated.
 *
 *   `--score-threshold 0.7` shipped as a bare literal in two `deno.json` tasks with no constant and
 *   no rationale, and pre-gap GAP-10 asked for one of the two. Step 7 then demonstrated by mutation
 *   that 0.7 discriminates — breaking flow output aggregation took two scenarios from 1.000 to
 *   0.500, where the same mutation scored 0.750 before the scoring fix — but the value itself
 *   stayed a literal.
 *
 *   A task string cannot import a constant, so the constant is the source of truth and this test is
 *   what keeps the two in step. Same shape as the constant-restatement gate one step over: the copy
 *   is allowed to exist, it is not allowed to drift unnoticed.
 * @dependencies [@exaix/core/types]
 * @related-files [packages/core/src/types/constants.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { SUBSYSTEM_EVAL_SCORE_THRESHOLD } from "@exaix/core/types";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");

/** The `deno.json` tasks that gate a subsystem run on the threshold. */
const THRESHOLD_TASKS = ["eval:subsystems", "eval:subsystems:core"];

async function readTasks(): Promise<Record<string, string>> {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json")));
  return config.tasks as Record<string, string>;
}

Deno.test("[eval-threshold] the threshold is declared as a constant with a usable range", () => {
  assertEquals(SUBSYSTEM_EVAL_SCORE_THRESHOLD, 0.7);
  assert(
    SUBSYSTEM_EVAL_SCORE_THRESHOLD > 0 && SUBSYSTEM_EVAL_SCORE_THRESHOLD < 1,
    "a threshold outside (0,1) cannot gate a suite score",
  );
});

Deno.test("[eval-threshold] every subsystem task passes the declared threshold", async () => {
  const tasks = await readTasks();
  const drifted: string[] = [];

  for (const name of THRESHOLD_TASKS) {
    const definition = tasks[name];
    assert(definition, `deno.json is missing the ${name} task`);

    const match = definition.match(/--score-threshold\s+(\S+)/);
    assert(match, `${name} must pass --score-threshold`);
    if (Number(match[1]) !== SUBSYSTEM_EVAL_SCORE_THRESHOLD) {
      drifted.push(`${name}: task says ${match[1]}, constant says ${SUBSYSTEM_EVAL_SCORE_THRESHOLD}`);
    }
  }

  assertEquals(
    drifted.sort(),
    [],
    "a deno.json task cannot import the constant, so the two are kept in step here:\n  " +
      drifted.join("\n  "),
  );
});

Deno.test("[eval-threshold] the threshold sits inside the corrected dynamic range", () => {
  // Before daemon-lifecycle steps were zero-weighted, a totally dead subsystem scored 0.800 and
  // the gate stayed green. The mutation that now takes a flow scenario to 0.500 is what makes 0.7
  // a gate rather than a decoration — the threshold must sit strictly between the two observations.
  const brokenScoreAfterScoringFix = 0.5;
  const brokenScoreBeforeScoringFix = 0.8;

  assert(
    SUBSYSTEM_EVAL_SCORE_THRESHOLD > brokenScoreAfterScoringFix,
    "the threshold must fire on the measured broken score (0.500)",
  );
  assert(
    SUBSYSTEM_EVAL_SCORE_THRESHOLD < brokenScoreBeforeScoringFix,
    "a threshold at or above 0.800 would restore the gate that could not fail",
  );
});
