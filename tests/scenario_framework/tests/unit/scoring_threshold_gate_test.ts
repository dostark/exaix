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
