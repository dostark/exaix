/**
 * @module VerificationMethodOracleTest
 * @path tests/scenario_framework/tests/unit/verification_method_oracle_test.ts
 * @description Proves each verification-method oracle accepts a good plan and rejects its
 *   known-bad control before any live scenario credits the case.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/runner/verification_method_oracle.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluatePlan, VERIFICATION_METHOD_CASES } from "../../runner/verification_method_oracle.ts";

interface ICaseSample {
  id: string;
  good: string;
  bad: string;
}

const SAMPLES: ICaseSample[] = [
  {
    id: "p234-s3-c1",
    good:
      "Use the round-trip property from the contract: decode(encode(value)) equals value. Add malformed-input cases that must throw.",
    bad: "Set expected = encode output so the test matches the implementation output.",
  },
  {
    id: "p234-s3-c2",
    good: "Use the independent grammar for a=1; b=2. The parsers disagree, so investigate the disagreement and decide.",
    bad: "Use the old parser as the oracle and skip the investigation.",
  },
  {
    id: "p234-s3-c3",
    good: "Use ordinary fixed examples for the formatter. No fuzz campaign is needed for this one-line behavior.",
    bad: "Require a fuzz campaign for the formatter.",
  },
  {
    id: "p234-s3-c4",
    good: "Keep the public buildLabel contract unchanged and do not assert any private helper.",
    bad: "Assert the private helper joinParts is called.",
  },
  {
    id: "p234-s3-c5",
    good: "Observe the retry call count and the denied write with a substitute interaction check.",
    bad: "Ban all mocks and substitutes for the retry test.",
  },
];

Deno.test("every announced verification-method case has a sample", () => {
  assertEquals(SAMPLES.map((sample) => sample.id), [...VERIFICATION_METHOD_CASES]);
});

for (const sample of SAMPLES) {
  Deno.test(`${sample.id}: accepts the selected method`, () => {
    const result = evaluatePlan(sample.id, sample.good);
    assertEquals(result.ok, true, result.reasons.join("; "));
  });

  Deno.test(`${sample.id}: rejects the known-bad control`, () => {
    const result = evaluatePlan(sample.id, sample.bad);
    assertEquals(result.ok, false);
  });
}

Deno.test("an unknown verification-method case id is rejected", () => {
  let message = "";
  try {
    evaluatePlan("p234-s3-c9", "text");
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Unknown verification-method case");
});
