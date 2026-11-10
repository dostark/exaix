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

import { registerOracleControls } from "../helpers/oracle_controls.ts";

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
  {
    id: "p234-v3-c1",
    good: "Use three fixed examples for the formatter. Add a canary for each. No fuzz campaign is needed.",
    bad: "A fuzz campaign is required for the formatter.",
  },
  {
    id: "p234-v3-c2",
    good: "Use a property test from the contract with a fixed seed and 100 bounded cases.",
    bad: "Copy the expected values from the implementation output.",
  },
  {
    id: "p234-v3-c3",
    good:
      "Compare the new parser with the existing parser, derive expectations from the reference, and investigate every disagreement.",
    bad: "The new parser is the oracle for the expected values.",
  },
];

Deno.test("every announced verification-method case has a sample", () => {
  assertEquals(SAMPLES.map((sample) => sample.id), [...VERIFICATION_METHOD_CASES]);
});

registerOracleControls(SAMPLES, evaluatePlan, "accepts the selected method");

Deno.test("verification oracle distinguishes rejecting implementation output from copying it", () => {
  const good =
    "The round-trip contract rejects malformed input. Expectations come from the contract, not implementation output.";
  const bad = `${good} Set expected = encode(value).`;
  assertEquals(evaluatePlan("p234-s3-c1", good).ok, true);
  assertEquals(evaluatePlan("p234-s3-c1", bad).ok, false);
  assertEquals(
    evaluatePlan(
      "p234-s3-c1",
      "Round-trip contract rejects malformed input; expected comes from contract, not from observed implementation output.",
    ).ok,
    true,
  );
  const negative =
    "Round-trip contract rejects malformed input. Tests do not derive expected errors from implementation output.";
  assertEquals(evaluatePlan("p234-s3-c1", negative).ok, true);
  assertEquals(evaluatePlan("p234-s3-c1", `${negative} Copy implementation output.`).ok, false);
});

Deno.test("independent parser oracle does not join sentences into a false assertion", () => {
  const good = "Investigate disagreement against the grammar, not either parser.\nfunction expected(input) {}";
  assertEquals(evaluatePlan("p234-s3-c2", good).ok, true);
  assertEquals(evaluatePlan("p234-s3-c2", `${good}\nUse the old parser as the oracle.`).ok, false);
});

Deno.test("private-helper checks distinguish conditional risk from a required assertion", () => {
  const good = "Keep the public output unchanged.\n" +
    "If any test explicitly asserts on the joinParts function name, it may fail.\n" +
    "Ensure no tests assert on private implementation details.";
  assertEquals(evaluatePlan("p234-s3-c4", good).ok, true);
  assertEquals(
    evaluatePlan("p234-s3-c4", `${good}\nCreate test asserting buildLabel output; no reference to joinParts.`).ok,
    true,
  );
  assertEquals(
    evaluatePlan("p234-s3-c4", `${good}\nThe test does not inspect or assert the private helper name.`).ok,
    true,
  );
  assertEquals(evaluatePlan("p234-s3-c4", `${good}\nAssert the private helper joinParts is called.`).ok, false);
  assertEquals(
    evaluatePlan("p234-s3-c4", "Keep public output unchanged. If running tests, assert the private helper is called.")
      .ok,
    false,
  );
});

Deno.test("an unknown verification-method case id is rejected", () => {
  let message = "";
  try {
    evaluatePlan("p234-s3-c9", "text");
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Unknown verification-method case");
});
