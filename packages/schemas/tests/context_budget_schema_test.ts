/**
 * @module ContextBudgetSchemaTest
 * @path packages/schemas/tests/context_budget_schema_test.ts
 * @description Validates ContextBudgetDecisionSchema and ContextBudgetSnapshotSchema.
 * @architectural-layer Tests
 * @related-files ["packages/schemas/src/execution/context_budget.ts"]
 */

import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { ZodError } from "zod";
import { ContextBudgetDecisionSchema, ContextBudgetSnapshotSchema } from "@exaix/schemas";

const validDecision = {
  segmentId: "seg-1",
  kind: "tool_result",
  action: "drop",
  originalTokens: 500,
  resultingTokens: 0,
  reason: "over budget",
  createdAt: new Date().toISOString(),
};

const validSnapshot = {
  traceId: "trace-abc",
  stepId: "step-1",
  model: "anthropic:claude-sonnet-5",
  maxContextTokens: 200_000,
  usedInputTokens: 1_500,
};

Deno.test("[ContextBudgetSchema] ContextBudgetDecisionSchema: accepts valid decision", () => {
  const result = ContextBudgetDecisionSchema.parse(validDecision);
  assertEquals(result.segmentId, "seg-1");
  assertEquals(result.action, "drop");
  assertEquals(result.originalTokens, 500);
});

Deno.test("[ContextBudgetSchema] ContextBudgetDecisionSchema: rejects action outside allowed enum", () => {
  assertThrows(
    () => ContextBudgetDecisionSchema.parse({ ...validDecision, action: "ignore" }),
    ZodError,
  );
});

Deno.test("[ContextBudgetSchema] ContextBudgetDecisionSchema: createdAt defaults to current ISO timestamp when omitted", () => {
  const result = ContextBudgetDecisionSchema.parse({ ...validDecision, createdAt: undefined });
  assertMatch(result.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("[ContextBudgetSchema] ContextBudgetDecisionSchema: rejects negative originalTokens", () => {
  assertThrows(
    () => ContextBudgetDecisionSchema.parse({ ...validDecision, originalTokens: -1 }),
    ZodError,
  );
});

Deno.test("[ContextBudgetSchema] ContextBudgetSnapshotSchema: accepts valid minimal snapshot with defaults applied", () => {
  const result = ContextBudgetSnapshotSchema.parse(validSnapshot);
  assertEquals(result.traceId, "trace-abc");
  assertEquals(result.decisions, []);
  assertEquals(result.overflowRecovered, false);
});

Deno.test("[ContextBudgetSchema] ContextBudgetSnapshotSchema: rejects snapshot with missing traceId", () => {
  const { traceId: _t, ...withoutTrace } = validSnapshot;
  assertThrows(() => ContextBudgetSnapshotSchema.parse(withoutTrace), ZodError);
});

Deno.test("[ContextBudgetSchema] ContextBudgetSnapshotSchema: rejects snapshot with missing stepId", () => {
  const { stepId: _s, ...withoutStep } = validSnapshot;
  assertThrows(() => ContextBudgetSnapshotSchema.parse(withoutStep), ZodError);
});

Deno.test("[ContextBudgetSchema] ContextBudgetSnapshotSchema: accepts snapshot with decisions array", () => {
  const result = ContextBudgetSnapshotSchema.parse({
    ...validSnapshot,
    decisions: [validDecision],
  });
  assertEquals(result.decisions.length, 1);
  assertEquals(result.decisions[0].segmentId, "seg-1");
});

Deno.test("[ContextBudgetSchema] ContextBudgetSnapshotSchema: accepts optional durationMs", () => {
  const result = ContextBudgetSnapshotSchema.parse({ ...validSnapshot, durationMs: 12 });
  assertEquals(result.durationMs, 12);
});
