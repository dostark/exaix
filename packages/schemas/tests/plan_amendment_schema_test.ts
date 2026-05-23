/**
 * @module PlanAmendmentSchemaTest
 * @path packages/schemas/tests/plan_amendment_schema_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Unit tests for plan amendment Zod schemas and type validation.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ZPlanAmendmentDecision, ZPlanAmendmentPatch, ZPlanAmendmentTrigger } from "@exaix/schemas";

Deno.test("ZPlanAmendmentTrigger validates correct trigger data", () => {
  const data = {
    source: "low_confidence",
    reason: "Confidence score below threshold",
    stepId: "1",
    confidenceScore: 45,
  };
  const parsed = ZPlanAmendmentTrigger.parse(data);
  assertEquals(parsed.source, "low_confidence");
  assertEquals(parsed.confidenceScore, 45);
});

Deno.test("ZPlanAmendmentPatch validates correct patch data with UUIDs", () => {
  const data = {
    amendmentId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    summary: "Refined steps based on tool output",
    affectedRemainingStepIds: ["2", "3"],
    adds: [
      { number: 4, title: "Cleanup", content: "Remove temp files" },
    ],
    updates: [
      { number: 2, title: "Analyze results", content: "Check the logs" },
    ],
    removes: ["3"],
    createdAt: new Date().toISOString(),
  };
  const parsed = ZPlanAmendmentPatch.parse(data);
  assertEquals(parsed.affectedRemainingStepIds.length, 2);
  assertEquals(parsed.adds.length, 1);
});

Deno.test("ZPlanAmendmentPatch rejects non-UUID IDs", () => {
  const data = {
    amendmentId: "invalid-uuid",
    planId: crypto.randomUUID(),
    summary: "...",
    affectedRemainingStepIds: [],
    adds: [],
    updates: [],
    removes: [],
    createdAt: new Date().toISOString(),
  };
  assertThrows(() => ZPlanAmendmentPatch.parse(data));
});

Deno.test("ZPlanAmendmentDecision validates correct decision data", () => {
  const data = {
    amendmentId: crypto.randomUUID(),
    decision: "approved",
    decidedBy: "user-123",
    decidedAt: new Date().toISOString(),
  };
  const parsed = ZPlanAmendmentDecision.parse(data);
  assertEquals(parsed.decision, "approved");
});
