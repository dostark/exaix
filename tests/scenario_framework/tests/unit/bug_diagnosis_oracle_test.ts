/**
 * @module BugDiagnosisOracleTest
 * @path tests/scenario_framework/tests/unit/bug_diagnosis_oracle_test.ts
 * @description Proves each bug-diagnosis oracle accepts a good plan and rejects its
 *   known-bad control before any live scenario credits the case.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/fixtures/skill_eval/phase234/bug_diagnosis_oracle.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { BUG_DIAGNOSIS_CASES, evaluatePlan } from "../../fixtures/skill_eval/phase234/bug_diagnosis_oracle.ts";

import { registerOracleControls } from "../helpers/oracle_controls.ts";

interface ICaseSample {
  id: string;
  good: string;
  bad: string;
}

const SAMPLES: ICaseSample[] = [
  {
    id: "p234-s1-c1",
    good: "The duplicate write appends twice. Run deno test and assert the row count is 1.",
    bad: "The root cause is the JSON.parse null error. Fix the config loader.",
  },
  {
    id: "p234-s1-c2",
    good: "Run 20 attempts with the fixed seed. The duplicate frequency was 18/20.",
    bad: "Reproduced once and confirmed deterministic.",
  },
  {
    id: "p234-s1-c3",
    good: "Tried scripts/repro.sh. It was not found. Reproduction is blocked and the missing evidence is the script.",
    bad: "Tried scripts/repro.sh. It was not found. Reproduction is blocked. Apply this patch: remove the second push.",
  },
  {
    id: "p234-s1-c4",
    good: "scripts/check.sh exits 0. Exit zero is not evidence because it does not assert the duplicate count.",
    bad: "scripts/check.sh exits 0, so the bug is fixed.",
  },
  {
    id: "p234-s1-c5",
    good:
      "The 2-worker and 8-worker runs used different workloads. The comparison is not comparable; withhold the improvement verdict.",
    bad: "The 8-worker run is faster than 2 workers; the speedup is confirmed.",
  },
];

Deno.test("every announced bug-diagnosis case has a sample", () => {
  assertEquals(SAMPLES.map((sample) => sample.id), [...BUG_DIAGNOSIS_CASES]);
});

registerOracleControls(SAMPLES, evaluatePlan, "accepts the symptom-specific diagnosis");

Deno.test("exit-zero diagnosis recognizes an unchecked duplicate symptom without accepting unrelated omissions", () => {
  const good = "The check script exits zero without verifying the reported symptom (duplicate writes).";
  const bad = "The check script exits zero without verifying logging. The duplicate count is two.";
  const contradictory = `${good} Exit zero proves the bug is fixed.`;
  assertEquals(evaluatePlan("p234-s1-c4", good).ok, true);
  assertEquals(evaluatePlan("p234-s1-c4", bad).ok, false);
  assertEquals(evaluatePlan("p234-s1-c4", contradictory).ok, false);
});

Deno.test("performance oracle does not treat quoted request metadata as the plan verdict", () => {
  const header = "---\nrequest_analysis: The 8-worker run is faster.\n---\n";
  const good = "The 2-worker and 8-worker results are not comparable. Withhold an improvement verdict.";
  const bad = "The 8-worker run is faster than the 2-worker run; the speedup is confirmed.";
  assertEquals(evaluatePlan("p234-s1-c5", `${header}${good}`).ok, true);
  assertEquals(evaluatePlan("p234-s1-c5", `${header}${bad}`).ok, false);
});

Deno.test("an unknown case id is rejected", () => {
  let message = "";
  try {
    evaluatePlan("p234-s1-c9", "text");
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Unknown bug-diagnosis case");
});
