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

Deno.test("complete requirements can record an already approved decision but cannot contradict it", () => {
  const base = samples[0].good;
  const approved = { ...base, decisions: [{ id: "D-zero", decision: 'renderCount(0) returns "0 items"' }] };
  const contradicted = { ...base, decisions: [{ id: "D-zero", decision: 'renderCount(0) returns "nothing"' }] };
  assertEquals(evaluateRequirements("p234-s5-c1", JSON.stringify(approved)).ok, true);
  assertEquals(evaluateRequirements("p234-s5-c1", JSON.stringify(contradicted)).ok, false);
});

Deno.test("stale invalidated assumptions and a named replacement criterion preserve the decision dependency", () => {
  const sample = samples.find((item) => item.case_id === "p234-s5-c3")!.good;
  const record = structuredClone(sample);
  record.assumptions[0].status = "STALE";
  record.acceptance[1].id = "AC-retention-replacement";
  assertEquals(evaluateRequirements("p234-s5-c3", JSON.stringify(record)).ok, true);
  record.assumptions[0].status = "VALID";
  assertEquals(evaluateRequirements("p234-s5-c3", JSON.stringify(record)).ok, false);
});

Deno.test("requirements answer requires a valid pending predecessor", () => {
  const answer = JSON.stringify(samples.find((sample) => sample.answer)!.good);
  assertEquals(evaluateRequirements("p234-s5-c2", answer, "{}").ok, false);
  assertEquals(evaluateRequirements("p234-s5-c2", answer, answer).ok, false);
});

Deno.test("pending retention recognizes stable IDs and already supplied decisions without inventing a period", () => {
  const sample = samples.find((item) => item.case_id === "p234-s5-c2" && !item.answer)!.good;
  const record = {
    ...sample,
    questions: [{ id: "Q-001", text: "Which retention period and time basis should apply?" }],
    acceptance: [
      { id: "AC-002", status: "PENDING", precondition: "completed event", expected: "Deletion requires Q-001" },
      { id: "AC-001", status: "RESOLVED", precondition: "active event", expected: "Never delete active events" },
    ],
    decisions: [{ id: "D-001", value: "Active events must never be deleted" }],
  };
  assertEquals(evaluateRequirements("p234-s5-c2", JSON.stringify(record)).ok, true);
  const invented = {
    ...record,
    decisions: [...record.decisions, { id: "D-invented", value: "30 days from created_at" }],
  };
  assertEquals(evaluateRequirements("p234-s5-c2", JSON.stringify(invented)).ok, false);
});

Deno.test("retention answer permits resolved questions and separate inclusive boundary criteria", () => {
  const answer = {
    case_id: "p234-s5-c2",
    status: "RESOLVED",
    questions: [{ id: "Q-1", status: "RESOLVED", earlier_record: "Earlier p234-s5-c2 requirements were pending" }],
    decisions: [{ id: "D-1", choice: "45 days from completed_at" }],
    assumptions: [],
    acceptance: [
      { id: "AC-1", status: "RESOLVED", criterion: "completed_at equals current time minus 45 days: delete" },
      { id: "AC-2", status: "RESOLVED", criterion: "completed_at earlier than current time minus 45 days: delete" },
      { id: "AC-3", status: "RESOLVED", criterion: "active events are not deleted" },
    ],
    terms: [],
    adr_proposals: [],
  };
  assertEquals(evaluateRequirements("p234-s5-c2", JSON.stringify(answer), prior).ok, true);
  const missingBoundary = { ...answer, acceptance: [answer.acceptance[0], answer.acceptance[2]] };
  assertEquals(evaluateRequirements("p234-s5-c2", JSON.stringify(missingBoundary), prior).ok, false);
});
