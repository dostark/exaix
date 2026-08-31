/**
 * @module MainExitCodesTest
 * @path tests/scenario_framework/tests/integration/main_exit_codes_test.ts
 * @description Integration tests for runner exit code semantics: exit 0 (all
 * passed), exit 1 (scenario below threshold or failed), and exit 2 (infrastructure
 * error). Exercises the runVerdict / threshold gate chain end-to-end.
 */

import { assertEquals } from "@std/assert";
import {
  accumulateRunVerdict,
  checkScoreThreshold,
  DEFAULT_EVAL_SCORE_THRESHOLD,
  type IRunVerdict,
  type IScenarioVerdict,
  RunVerdict,
} from "../../runner/scoring.ts";

// Simulates the runner's exit-code logic:
//   infraError → exit 2, !allPassed → exit 1, else → exit 0
function deriveExitCode(runVerdict: IRunVerdict): number {
  if (runVerdict.infraError) return 2;
  if (!runVerdict.allPassed) return 1;
  return 0;
}

Deno.test("[MainExitCodes] all scenarios above threshold → exit 0", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: checkScoreThreshold(0.9, DEFAULT_EVAL_SCORE_THRESHOLD) },
    { scenarioId: "s2", pack: "p1", suiteScore: 0.8, passed: checkScoreThreshold(0.8, DEFAULT_EVAL_SCORE_THRESHOLD) },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(deriveExitCode(verdict), 0);
});

Deno.test("[MainExitCodes] one scenario below threshold → exit 1", () => {
  const threshold = 0.5;
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: checkScoreThreshold(0.9, threshold) },
    { scenarioId: "s2", pack: "p1", suiteScore: 0.3, passed: checkScoreThreshold(0.3, threshold) },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(deriveExitCode(verdict), 1);
});

Deno.test("[MainExitCodes] infrastructure error → exit 2", () => {
  const verdict: IRunVerdict = { ...RunVerdict.INFRA_ERROR, scenarios: [] };
  assertEquals(deriveExitCode(verdict), 2);
});

Deno.test("[MainExitCodes] infraError overrides allPassed scenarios → exit 2", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: true },
  ];
  const verdict: IRunVerdict = { allPassed: false, infraError: true, scenarios };
  assertEquals(deriveExitCode(verdict), 2);
});

Deno.test("[MainExitCodes] empty scenario list → exit 0 (vacuously passing)", () => {
  const verdict = accumulateRunVerdict([]);
  assertEquals(deriveExitCode(verdict), 0);
});

Deno.test("[MainExitCodes] scenario-failure without threshold → exit 1", () => {
  // Scenario outcome is "scenario-failure" (outcome !== "success") so passed=false
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.0, passed: false },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(deriveExitCode(verdict), 1);
});

Deno.test("[MainExitCodes] high threshold (0.99) fails a 0.9-scoring scenario → exit 1", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: checkScoreThreshold(0.9, 0.99) },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(deriveExitCode(verdict), 1);
});

Deno.test("[MainExitCodes] low threshold (0.1) lets a 0.9-scoring scenario pass → exit 0", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.9, passed: checkScoreThreshold(0.9, 0.1) },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(deriveExitCode(verdict), 0);
});

Deno.test("[MainExitCodes] boundary equality (score === threshold) passes → exit 0", () => {
  const scenarios: IScenarioVerdict[] = [
    { scenarioId: "s1", pack: "p1", suiteScore: 0.5, passed: checkScoreThreshold(0.5, 0.5) },
  ];
  const verdict = accumulateRunVerdict(scenarios);
  assertEquals(deriveExitCode(verdict), 0);
});
