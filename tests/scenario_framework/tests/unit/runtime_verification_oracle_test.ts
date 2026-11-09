/**
 * @module RuntimeVerificationOracleTest
 * @path tests/scenario_framework/tests/unit/runtime_verification_oracle_test.ts
 * @description Proves each runtime verification oracle accepts a good plan and rejects its
 *   known-bad control before any live scenario credits the case.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/runner/runtime_verification_oracle.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluatePlan, RUNTIME_VERIFICATION_CASES } from "../../runner/runtime_verification_oracle.ts";

import { registerOracleControls } from "../helpers/oracle_controls.ts";

interface ICaseSample {
  id: string;
  good: string;
  bad: string;
}

const SAMPLES: ICaseSample[] = [
  {
    id: "p234-s4-c1",
    good:
      "Run the fuzz script with the fixed seed and a bound. Minimize the failing token and keep it as the malformed regression.",
    bad: "Report only an unreproducible random failure from the malformed parser run.",
  },
  {
    id: "p234-s4-c2",
    good: "Derive the expected value from the written contract for clamp(-1, 0, 10).",
    bad: "Copy the expected value from the source implementation.",
  },
  {
    id: "p234-s4-c3",
    good: "Use fixed examples for greet. No mutation or fuzz campaign is needed for this small behavior.",
    bad: "Require a mutation campaign for the small behavior edit.",
  },
  {
    id: "p234-s4-c4",
    good: "Keep the public buildLabel contract unchanged and assert no private call graph.",
    bad: "Assert the private call graph in the refactor test.",
  },
  {
    id: "p234-s4-c5",
    good: "For the denied role, observe zero writes with a substitute call count on the writer.",
    bad: "A success response is proof of no write for the denied role.",
  },
];

Deno.test("every announced runtime verification case has a sample", () => {
  assertEquals(SAMPLES.map((sample) => sample.id), [...RUNTIME_VERIFICATION_CASES]);
});

registerOracleControls(SAMPLES, evaluatePlan, "accepts the selected method");

Deno.test("private refactor accepts a stable public output without allowing private call assertions", () => {
  const good = "Keep the public buildLabel output stable and anchored by a contract test.";
  assertEquals(evaluatePlan("p234-s4-c4", good).ok, true);
  assertEquals(evaluatePlan("p234-s4-c4", `${good} Assert the private call graph.`).ok, false);
  const negative = `${good} Tests must not depend on the private helper or its call graph.`;
  assertEquals(evaluatePlan("p234-s4-c4", negative).ok, true);
  assertEquals(evaluatePlan("p234-s4-c4", `${negative} Assert the private call graph.`).ok, false);
});

Deno.test("an unknown runtime verification case id is rejected", () => {
  let message = "";
  try {
    evaluatePlan("p234-s4-c9", "text");
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Unknown runtime verification case");
});
