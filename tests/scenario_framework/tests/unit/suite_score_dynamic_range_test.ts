/**
 * @module ScenarioFrameworkSuiteScoreDynamicRangeTest
 * @path tests/scenario_framework/tests/unit/suite_score_dynamic_range_test.ts
 * @description Phase 142 Step 7 — a scenario whose behaviour-under-test fails must score below the
 *   gate that is supposed to catch it.
 *
 *   `computeSuiteScore` is a step-weighted mean with `DEFAULT_STEP_WEIGHT = 1.0` and no
 *   `step_weight` declared anywhere in the six packs, so the score was really *the fraction of
 *   steps that passed* — and most steps are harness plumbing that passes whether or not the feature
 *   works. Measured in Step 17 by mutating the skills pack: reverting `createFromFile` so that
 *   **every** pinned skill was dropped scored **0.800**, above the 0.7 threshold this phase
 *   proposes. The gate would have stayed green over a completely dead subsystem.
 *
 *   Worse as a signal: a mutation killing tag-driven skill matching entirely reported 0.971, which
 *   trended looks like healthy noise.
 *
 *   The fix keys on what a step DOES, not what it is called — the same move Step 13 made for the
 *   daemon-teardown guard, which had keyed on the step id being exactly `start-daemon` and missed
 *   the 25 scenarios using `restart-daemon`. Starting or stopping a daemon is lifecycle: it passing
 *   says nothing about the behaviour under test, so it contributes no weight. Annotating ~100
 *   scenarios by hand would have produced the same number and a new drift surface.
 *
 *   An explicit `step_weight` still wins, so a scenario that genuinely asserts something about
 *   daemon lifecycle can say so.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { computeSuiteScore, type IStepScoreInput } from "../../runner/scoring.ts";
import { type IScenarioStep, ScenarioStepType } from "../../schema/step_schema.ts";

/** The gate `eval:subsystems` installs. The point of the fix is that a broken pack falls under it. */
const GATE_THRESHOLD = 0.7;

function step(partial: Partial<IScenarioStep> & { id: string }): IScenarioStep {
  return {
    type: ScenarioStepType.EXACTL,
    input_criteria: [],
    output_criteria: [],
    ...partial,
  } as IScenarioStep;
}

function outcome(stepDef: IScenarioStep, score: number): IStepScoreInput {
  return { stepId: stepDef.id, step: stepDef, score };
}

/** The shape every remediated pack scenario now has. */
function scenarioOutcomes(assertionScore: number): IStepScoreInput[] {
  return [
    outcome(step({ id: "start-daemon", command: "daemon", args: ["start"] }), 1),
    outcome(step({ id: "submit-request", command: "request", args: ["--file", "x.md"] }), 1),
    outcome(step({ id: "wait-for-plan", type: ScenarioStepType.WAIT_FOR_FILE, args: ["**/*.md"] }), 1),
    outcome(step({ id: "assert-behaviour", command: "journal" }), assertionScore),
    outcome(step({ id: "stop-daemon", command: "daemon", args: ["stop"] }), 1),
  ];
}

Deno.test("[score-range] a fully passing scenario still scores 1.0", () => {
  assertEquals(computeSuiteScore(scenarioOutcomes(1)), 1.0);
});

Deno.test("[score-range] a failed assertion drops the scenario below the gate", () => {
  const score = computeSuiteScore(scenarioOutcomes(0));
  assert(
    score < GATE_THRESHOLD,
    `a scenario whose behaviour-under-test failed scored ${score}, at or above the ${GATE_THRESHOLD} gate`,
  );
});

Deno.test("[score-range] the pre-fix arithmetic is what this replaces", () => {
  // Documents the defect rather than trusting the prose: five equally-weighted steps with one
  // failure is 4/5 = 0.800, comfortably above a 0.7 gate. The daemon steps must not count.
  const equallyWeighted = scenarioOutcomes(0).map((entry) => ({
    ...entry,
    step: { ...entry.step, step_weight: 1 },
  }));
  assertEquals(computeSuiteScore(equallyWeighted), 0.8);
});

Deno.test("[score-range] daemon lifecycle steps carry no weight, by what they do", () => {
  // `restart` too — an id-keyed check missed 25 scenarios using `restart-daemon` entirely.
  for (const args of [["start"], ["stop"], ["restart"]]) {
    const onlyLifecycle = [outcome(step({ id: `daemon-${args[0]}`, command: "daemon", args }), 1)];
    // A scenario of nothing but lifecycle has no assertable content; it must not report 1.0.
    assertEquals(computeSuiteScore(onlyLifecycle), 0.0, `daemon ${args[0]} must not carry weight`);
  }
});

Deno.test("[score-range] an explicit step_weight always wins", () => {
  // A scenario genuinely asserting something about daemon lifecycle can say so.
  const explicit = [
    outcome(step({ id: "start-daemon", command: "daemon", args: ["start"], step_weight: 1 }), 0),
    outcome(step({ id: "assert", command: "journal" }), 1),
  ];
  assertEquals(computeSuiteScore(explicit), 0.5);
});

Deno.test("[score-range] a non-daemon exactl step keeps full weight", () => {
  const scored = computeSuiteScore([
    outcome(step({ id: "submit", command: "request" }), 0),
    outcome(step({ id: "assert", command: "journal" }), 1),
  ]);
  assertEquals(scored, 0.5, "only daemon lifecycle is plumbing; a request submission is not");
});

Deno.test("[score-range] adding a lifecycle step no longer raises a broken scenario's floor", () => {
  // The perverse incentive named in the plan: adding a seeding step to each skill scenario
  // moved its failure floor from 0.750 to 0.800 — it "scored better" purely by growing.
  const withoutExtra = computeSuiteScore(scenarioOutcomes(0));
  const withExtra = computeSuiteScore([
    ...scenarioOutcomes(0),
    outcome(step({ id: "restart-daemon", command: "daemon", args: ["restart"] }), 1),
  ]);
  assertEquals(withExtra, withoutExtra, "a lifecycle step must not move the score at all");
});
