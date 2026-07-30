/**
 * @module ScoringThresholdGateTest
 * @path tests/scenario_framework/tests/unit/scoring_threshold_gate_test.ts
 * @description Tests for score-threshold gating logic: RunVerdict accumulation,
 * threshold pass/fail determination, boundary equality, and infrastructure-error
 * classification.
 */

import { assertEquals } from "@std/assert";
import {
  accumulateRunVerdict,
  checkScoreThreshold,
  type IRunVerdict,
  type IScenarioVerdict,
  resolveScenarioVerdict,
} from "../../runner/scoring.ts";

Deno.test("[ScoreThreshold] checkScoreThreshold — score above threshold passes", () => {
  assertEquals(checkScoreThreshold(0.9, 0.5), true);
});

Deno.test("[ScoreThreshold] checkScoreThreshold — score below threshold fails", () => {
  assertEquals(checkScoreThreshold(0.3, 0.5), false);
});

Deno.test("[ScoreThreshold] checkScoreThreshold — boundary equality passes", () => {
  assertEquals(checkScoreThreshold(0.5, 0.5), true);
});

Deno.test("[ScoreThreshold] checkScoreThreshold — score of 0 and threshold of 0 passes", () => {
  assertEquals(checkScoreThreshold(0, 0), true);
});

Deno.test("[ScoreThreshold] checkScoreThreshold — score of 1 with any threshold up to 1 passes", () => {
  assertEquals(checkScoreThreshold(1, 0.99), true);
  assertEquals(checkScoreThreshold(1, 1), true);
});

Deno.test("[ScoreThreshold] checkScoreThreshold — threshold of 0 always passes", () => {
  assertEquals(checkScoreThreshold(0, 0), true);
  assertEquals(checkScoreThreshold(0.1, 0), true);
  assertEquals(checkScoreThreshold(1, 0), true);
});

Deno.test("[ScoreThreshold] accumulateRunVerdict — all scenarios above threshold → allPassed true, infraError false", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: true },
    { scenarioId: "s2", pack: "p1", suiteScore: 0.8, passed: true },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(verdict.allPassed, true);
  assertEquals(verdict.infraError, false);
});

Deno.test("[ScoreThreshold] accumulateRunVerdict — one scenario below threshold → allPassed false", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: true },
    { scenarioId: "s2", pack: "p1", suiteScore: 0.3, passed: false },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(verdict.allPassed, false);
  assertEquals(verdict.infraError, false);
});

Deno.test("[ScoreThreshold] accumulateRunVerdict — infraError overrides allPassed", () => {
  const verdict: IRunVerdict = {
    allPassed: false,
    infraError: true,
    scenarios: [],
  };
  assertEquals(verdict.allPassed, false);
  assertEquals(verdict.infraError, true);
});

Deno.test("[ScoreThreshold] accumulateRunVerdict — empty scenario list → vacuously passing", () => {
  const verdict = accumulateRunVerdict([]);
  assertEquals(verdict.allPassed, true);
  assertEquals(verdict.infraError, false);
});

Deno.test("[ScoreThreshold] accumulateRunVerdict — single scenario that passes", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "solo", pack: "p1", suiteScore: 0.95, passed: true },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(verdict.allPassed, true);
  assertEquals(verdict.scenarios.length, 1);
  assertEquals(verdict.scenarios[0].scenarioId, "solo");
});

// Phase 150 LIVE-RT: the first real delegate run reported ✅ PASSED at 0.727 while
// its manifest recorded outcome "scenario-failure" — three outcome assertions had
// failed (no briefed event, no reconciled event, file unchanged) but the weighted
// suite score still cleared the gate. A threshold may only ever LOWER a verdict;
// it must never override steps that actually failed.
Deno.test("[ScoreThreshold] resolveScenarioVerdict — failed steps cannot pass on score alone", () => {
  assertEquals(resolveScenarioVerdict("scenario-failure", 0.727, 0.5), false);
});

Deno.test("[ScoreThreshold] resolveScenarioVerdict — success below threshold still fails", () => {
  assertEquals(resolveScenarioVerdict("success", 0.3, 0.5), false);
});

Deno.test("[ScoreThreshold] resolveScenarioVerdict — success above threshold passes", () => {
  assertEquals(resolveScenarioVerdict("success", 0.9, 0.5), true);
});

Deno.test("[ScoreThreshold] resolveScenarioVerdict — no threshold falls back to outcome", () => {
  assertEquals(resolveScenarioVerdict("success", 0.1, undefined), true);
  assertEquals(resolveScenarioVerdict("scenario-failure", 1.0, undefined), false);
});

Deno.test("[ScoreThreshold] resolveScenarioVerdict — a missing manifest never passes", () => {
  assertEquals(resolveScenarioVerdict(undefined, 1.0, 0.5), false);
});
