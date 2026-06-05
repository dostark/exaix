/**
 * @module TriggerSchemasTest
 * @path packages/core/tests/triggers/schemas_test.ts
 * @description Tests for trigger Zod schemas, inferred types, and idempotency-key helpers.
 * @architectural-layer Core
 * @related-files [packages/core/src/triggers/schemas.ts, packages/core/src/triggers/idempotency.ts]
 */

import { assertEquals } from "@std/assert";
import {
  ExecutionTriggerEnvelopeSchema,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  normalizeIdempotencyKey,
  TriggerActionSchema,
  TriggerDecisionSchema,
  TriggerSourceSchema,
  validateIdempotencyKey,
} from "@exaix/core/triggers";

Deno.test("[TriggerEnvelopeSchema] validates a complete envelope", () => {
  const result = ExecutionTriggerEnvelopeSchema.safeParse({
    triggerId: crypto.randomUUID(),
    source: "cli",
    action: "start_flow",
    idempotencyKey: "my-key-1",
    subject: "Run tests",
    occurredAt: "2026-06-05T00:00:00Z",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.source, "cli");
    assertEquals(result.data.action, "start_flow");
    assertEquals(result.data.idempotencyKey, "my-key-1");
    assertEquals(result.data.subject, "Run tests");
  }
});

Deno.test("[TriggerEnvelopeSchema] applies default triggerId when omitted", () => {
  const result = ExecutionTriggerEnvelopeSchema.safeParse({
    source: "cli",
    action: "start_flow",
    idempotencyKey: "key-1",
    subject: "Test",
    occurredAt: "2026-06-05T00:00:00Z",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(typeof result.data.triggerId, "string");
    // UUID v4 format
    assertEquals(result.data.triggerId.length, 36);
  }
});

Deno.test("[TriggerEnvelopeSchema] rejects invalid triggerId format", () => {
  const result = ExecutionTriggerEnvelopeSchema.safeParse({
    triggerId: "not-a-uuid",
    source: "cli",
    action: "start_flow",
    idempotencyKey: "key-1",
    subject: "Test",
    occurredAt: "2026-06-05T00:00:00Z",
  });
  assertEquals(result.success, false);
});

Deno.test("[TriggerEnvelopeSchema] rejects empty subject", () => {
  const result = ExecutionTriggerEnvelopeSchema.safeParse({
    triggerId: crypto.randomUUID(),
    source: "cli",
    action: "start_flow",
    idempotencyKey: "key-1",
    subject: "",
    occurredAt: "2026-06-05T00:00:00Z",
  });
  assertEquals(result.success, false);
});

Deno.test("[TriggerEnvelopeSchema] accepts optional traceId", () => {
  const traceId = crypto.randomUUID();
  const result = ExecutionTriggerEnvelopeSchema.safeParse({
    triggerId: crypto.randomUUID(),
    source: "cli",
    action: "start_flow",
    idempotencyKey: "key-1",
    subject: "Test",
    traceId,
    occurredAt: "2026-06-05T00:00:00Z",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.traceId, traceId);
  }
});

Deno.test("[TriggerEnvelopeSchema] applies default payload/metadata", () => {
  const result = ExecutionTriggerEnvelopeSchema.safeParse({
    triggerId: crypto.randomUUID(),
    source: "cli",
    action: "start_flow",
    idempotencyKey: "key-1",
    subject: "Test",
    occurredAt: "2026-06-05T00:00:00Z",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.payload, {});
    assertEquals(result.data.metadata, {});
  }
});

Deno.test("[TriggerSourceSchema] rejects unknown sources", () => {
  const result = TriggerSourceSchema.safeParse("unknown_source");
  assertEquals(result.success, false);
});

Deno.test("[TriggerActionSchema] rejects unknown actions", () => {
  const result = TriggerActionSchema.safeParse("unknown_action");
  assertEquals(result.success, false);
});

Deno.test("[TriggerDecisionSchema] validates accepted decision", () => {
  const result = TriggerDecisionSchema.safeParse({
    accepted: true,
    normalizedIntent: "run-tests",
    targetFlowId: crypto.randomUUID(),
  });
  assertEquals(result.success, true);
});

Deno.test("[TriggerDecisionSchema] validates rejected decision", () => {
  const result = TriggerDecisionSchema.safeParse({
    accepted: false,
    rejectionReason: "duplicate_idempotency_key",
  });
  assertEquals(result.success, true);
});

Deno.test("[IdempotencyKey] normalizes whitespace", () => {
  assertEquals(normalizeIdempotencyKey("  my-key  "), "my-key");
  assertEquals(normalizeIdempotencyKey("\tmy-key\n"), "my-key");
});

Deno.test("[IdempotencyKey] rejects empty key", () => {
  assertEquals(validateIdempotencyKey(""), false);
  assertEquals(validateIdempotencyKey("  "), false);
});

Deno.test("[IdempotencyKey] rejects key exceeding max length", () => {
  const longKey = "x".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1);
  assertEquals(validateIdempotencyKey(longKey), false);
});

Deno.test("[IdempotencyKey] accepts valid keys", () => {
  assertEquals(validateIdempotencyKey("my-key"), true);
  assertEquals(validateIdempotencyKey("x".repeat(MAX_IDEMPOTENCY_KEY_LENGTH)), true);
});
