/**
 * @module ToolConfirmationSchemaTest
 * @path packages/schemas/tests/tool_confirmation_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Tests for ToolConfirmationRequestSchema and ToolConfirmationDecisionSchema
 * defined in packages/schemas/src/tool_confirmation.ts (Step 79.1).
 */

import { assertEquals, assertFalse } from "@std/assert";
import { ToolConfirmationDecisionSchema, ToolConfirmationRequestSchema } from "@exaix/schemas/tool_confirmation.ts";

// ── ToolConfirmationRequestSchema ─────────────────────────────────────────────

Deno.test("ToolConfirmationRequestSchema: valid request round-trips correctly", () => {
  const input = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    toolName: "exaix_create_request",
    args: { title: "New feature" },
    stepId: "step-1",
    traceId: "trace-abc",
    requestedAt: "2026-05-17T10:00:00.000Z",
    expiresAt: "2026-05-17T10:02:00.000Z",
  };

  const result = ToolConfirmationRequestSchema.parse(input);

  assertEquals(result.id, input.id);
  assertEquals(result.toolName, input.toolName);
  assertEquals(result.args, input.args);
  assertEquals(result.stepId, input.stepId);
  assertEquals(result.traceId, input.traceId);
  assertEquals(result.requestedAt, input.requestedAt);
  assertEquals(result.expiresAt, input.expiresAt);
});

Deno.test("ToolConfirmationRequestSchema: invalid UUID on id fails", () => {
  const input = {
    id: "not-a-uuid",
    toolName: "exaix_create_request",
    args: {},
    stepId: "step-1",
    traceId: "trace-abc",
    requestedAt: "2026-05-17T10:00:00.000Z",
    expiresAt: "2026-05-17T10:02:00.000Z",
  };

  const result = ToolConfirmationRequestSchema.safeParse(input);

  assertFalse(result.success, "Expected parse to fail for non-UUID id");
});

Deno.test("ToolConfirmationRequestSchema: missing required fields fail with descriptive error", () => {
  const result = ToolConfirmationRequestSchema.safeParse({
    id: "550e8400-e29b-41d4-a716-446655440000",
    // toolName missing
    args: {},
    stepId: "step-1",
    traceId: "trace-abc",
    requestedAt: "2026-05-17T10:00:00.000Z",
    expiresAt: "2026-05-17T10:02:00.000Z",
  });

  assertFalse(result.success);
  if (!result.success) {
    const fieldPaths = result.error.errors.map((e: { path: (string | number)[] }) => e.path.join("."));
    assertEquals(fieldPaths.includes("toolName"), true, "Error must name the missing toolName field");
  }
});

Deno.test("ToolConfirmationRequestSchema: empty toolName fails", () => {
  const result = ToolConfirmationRequestSchema.safeParse({
    id: "550e8400-e29b-41d4-a716-446655440000",
    toolName: "",
    args: {},
    stepId: "step-1",
    traceId: "trace-abc",
    requestedAt: "2026-05-17T10:00:00.000Z",
    expiresAt: "2026-05-17T10:02:00.000Z",
  });

  assertFalse(result.success, "Empty toolName must be rejected");
});

// ── ToolConfirmationDecisionSchema ────────────────────────────────────────────

Deno.test("ToolConfirmationDecisionSchema: denial with TIMEOUT reason parses correctly", () => {
  const input = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    approved: false,
    reason: "TIMEOUT",
    decidedAt: "2026-05-17T10:02:00.000Z",
    decidedBy: "system:timeout",
  };

  const result = ToolConfirmationDecisionSchema.parse(input);

  assertEquals(result.approved, false);
  assertEquals(result.reason, "TIMEOUT");
  assertEquals(result.decidedBy, "system:timeout");
});

Deno.test("ToolConfirmationDecisionSchema: approval without optional fields is valid", () => {
  const input = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    approved: true,
    decidedAt: "2026-05-17T10:00:30.000Z",
  };

  const result = ToolConfirmationDecisionSchema.parse(input);

  assertEquals(result.approved, true);
  assertEquals(result.reason, undefined);
  assertEquals(result.decidedBy, undefined);
});

Deno.test("ToolConfirmationDecisionSchema: invalid UUID on id fails", () => {
  const result = ToolConfirmationDecisionSchema.safeParse({
    id: "bad-id",
    approved: true,
    decidedAt: "2026-05-17T10:00:30.000Z",
  });

  assertFalse(result.success, "Non-UUID id must be rejected");
});
