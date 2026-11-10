/**
 * @module PlanningDecisionsOracleTest
 * @path tests/scenario_framework/tests/unit/planning_decisions_oracle_test.ts
 * @description Verifies planning outcomes, compatible migration dependencies, and independent incorrect controls.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/planning_decisions_oracle.ts]
 */
import { assertEquals, assertThrows } from "@std/assert";
import { evaluatePlanning } from "../../runner/planning_decisions_oracle.ts";
import { applyRequirementsControl } from "../helpers/requirements_controls.ts";
import samples from "../../fixtures/planning_decisions/records.json" with { type: "json" };

for (const sample of samples) {
  Deno.test(`${sample.case_id}: accepts the required planning outcome`, () => {
    const result = evaluatePlanning(sample.case_id, JSON.stringify(sample.good));
    assertEquals(result.ok, true, result.reasons.join("\n"));
  });
  for (const [index, changes] of sample.bad.entries()) {
    Deno.test(`${sample.case_id}: rejects incorrect planning outcome ${index}`, () => {
      const record = applyRequirementsControl(JSON.stringify(sample.good), JSON.stringify(changes));
      assertEquals(evaluatePlanning(sample.case_id, record).ok, false);
    });
  }
}

Deno.test("p234-s6-c5 accepts equivalent ADR wording and outcome shapes", () => {
  const sample = samples.find((candidate) => candidate.case_id === "p234-s6-c5");
  if (!sample) throw new Error("missing p234-s6-c5 sample");
  const good = structuredClone(sample.good) as {
    acceptance: Array<{ id: string; status: string; outcome: object }>;
    adr_proposals: Array<{ alternatives: string[]; hard_to_reverse: string }>;
  };
  const proposal = good.adr_proposals[0];
  proposal.alternatives = ["Mutable ledger rows", "Immutable signed ledger with append-only corrections"];
  proposal.hard_to_reverse =
    "Independent verification would break because the original signed bytes cannot be reconstructed after rewriting.";
  good.acceptance.find((entry) => entry.id === "AC-label")!.outcome = {
    screen_label: "Runs",
    replaces: "Executions",
  };
  good.acceptance.find((entry) => entry.id === "AC-correction")!.outcome = {
    original_entry: "Original signed bytes remain unchanged and independently verifiable.",
    correction: "A correction is appended as a separate entry linked to the original.",
    read_model: "The read model distinguishes originals and corrections.",
    migration: "Preserve original signed bytes.",
  };
  assertEquals(evaluatePlanning("p234-s6-c5", JSON.stringify(good)).ok, true);
});

Deno.test("planning oracle rejects malformed records and mismatched or duplicate identities", () => {
  const first = samples[0].good;
  for (const raw of ["not JSON", "{}", JSON.stringify({ ...first, acceptance: [] })]) {
    assertEquals(evaluatePlanning(first.case_id, raw).ok, false);
  }
  assertEquals(evaluatePlanning("p234-s6-c4", JSON.stringify(first)).ok, false);
  const duplicate = { ...first, stages: [first.stages[0], first.stages[0]] };
  assertEquals(evaluatePlanning(first.case_id, JSON.stringify(duplicate)).ok, false);
  assertThrows(() => evaluatePlanning("unknown", "{}"), Error, "Unknown planning case");
});

Deno.test("planning oracle reads one JSON fence and rejects multiple competing records", () => {
  const record = JSON.stringify(samples[0].good);
  const fenced = ["Plan", "```json", record, "```"].join("\n");
  assertEquals(evaluatePlanning("p234-s6-c1", fenced).ok, true);
  assertEquals(evaluatePlanning("p234-s6-c1", `${fenced}\n${fenced}`).ok, false);
});
