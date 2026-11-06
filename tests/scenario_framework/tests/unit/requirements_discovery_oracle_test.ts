/**
 * @module RequirementsDiscoveryOracleTest
 * @path tests/scenario_framework/tests/unit/requirements_discovery_oracle_test.ts
 * @description Checks requirements outcomes and rejects plausible but incorrect artifact records.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/requirements_discovery_oracle.ts]
 */
import { assertEquals, assertThrows } from "@std/assert";
import { evaluateRequirements } from "../../runner/requirements_discovery_oracle.ts";
import { applyRequirementsControl } from "../helpers/requirements_controls.ts";
import samples from "../../fixtures/requirements_discovery/records.json" with { type: "json" };

const prior = JSON.stringify(samples.find((sample) => sample.case_id === "p234-s5-c2" && !sample.answer)!.good);
for (const sample of samples) {
  const turn = sample.answer ? "answer" : "initial";
  Deno.test(`${sample.case_id} ${turn}: accepts the required domain outcome`, () => {
    const result = evaluateRequirements(sample.case_id, JSON.stringify(sample.good), sample.answer ? prior : undefined);
    assertEquals(result.ok, true, result.reasons.join("\n"));
  });
  for (const [index, bad] of sample.bad.entries()) {
    Deno.test(`${sample.case_id} ${turn}: rejects incorrect outcome ${index}`, () => {
      const badRecord = applyRequirementsControl(JSON.stringify(sample.good), JSON.stringify(bad));
      const result = evaluateRequirements(sample.case_id, badRecord, sample.answer ? prior : undefined);
      assertEquals(result.ok, false);
    });
  }
}

Deno.test("requirements oracle rejects malformed, empty and misidentified artifacts", () => {
  for (const text of ["not JSON", "{}", JSON.stringify({ ...samples[0].good, acceptance: [] })]) {
    assertEquals(evaluateRequirements("p234-s5-c1", text).ok, false);
  }
  assertEquals(evaluateRequirements("p234-s5-c4", JSON.stringify(samples[0].good)).ok, false);
  assertThrows(() => evaluateRequirements("not-a-case", "{}"), Error, "Unknown requirements case");
});

Deno.test("requirements answer requires a valid pending predecessor", () => {
  const answer = JSON.stringify(samples.find((sample) => sample.answer)!.good);
  assertEquals(evaluateRequirements("p234-s5-c2", answer, "{}").ok, false);
  assertEquals(evaluateRequirements("p234-s5-c2", answer, answer).ok, false);
});
