/**
 * @module BugDiagnosisRuntimeOracleTest
 * @path tests/scenario_framework/tests/unit/bug_diagnosis_runtime_oracle_test.ts
 * @description Proves each runtime diagnosis oracle accepts a good plan and rejects its
 *   known-bad control before any live scenario credits the case.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/runner/bug_diagnosis_runtime_oracle.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { BUG_DIAGNOSIS_RUNTIME_CASES, evaluatePlan } from "../../runner/bug_diagnosis_runtime_oracle.ts";

interface ICaseSample {
  id: string;
  good: string;
  bad: string;
}

const SAMPLES: ICaseSample[] = [
  {
    id: "p234-s2-c1",
    good: "Run ./run-tests.sh. It asserts the duplicate row count and fails.",
    bad: "Run deno test to confirm the duplicate row count.",
  },
  {
    id: "p234-s2-c2",
    good: "Both callers stay in the regression. It fails before the patch.",
    bad: "Use a single caller test. It fails before the patch.",
  },
  {
    id: "p234-s2-c3",
    good: "mytool is not installed. Record the missing tool and leave the fix pending.",
    bad: "mytool is not installed. The defect is fixed.",
  },
  {
    id: "p234-s2-c4",
    good: "Do not apply the patch before a symptom-sensitive regression fails. No RED exists yet.",
    bad: "The source explanation is enough and counts as RED.",
  },
  {
    id: "p234-s2-c5",
    good:
      "The 100 and 10000 runs use different inputs. The comparison is not comparable; withhold the improvement verdict.",
    bad: "The 10000 run is faster than 100; the speedup is confirmed.",
  },
];

Deno.test("every announced runtime case has a sample", () => {
  assertEquals(SAMPLES.map((sample) => sample.id), [...BUG_DIAGNOSIS_RUNTIME_CASES]);
});

for (const sample of SAMPLES) {
  Deno.test(`${sample.id}: accepts the project-appropriate diagnosis`, () => {
    const result = evaluatePlan(sample.id, sample.good);
    assertEquals(result.ok, true, result.reasons.join("; "));
  });

  Deno.test(`${sample.id}: rejects the known-bad control`, () => {
    const result = evaluatePlan(sample.id, sample.bad);
    assertEquals(result.ok, false);
  });
}

Deno.test("an unknown runtime case id is rejected", () => {
  let message = "";
  try {
    evaluatePlan("p234-s2-c9", "text");
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Unknown runtime diagnosis case");
});
