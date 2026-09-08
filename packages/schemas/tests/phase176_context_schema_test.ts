/**
 * @module Phase176ContextSchemaTest
 * @path packages/schemas/tests/phase176_context_schema_test.ts
 * @description Phase 176 Step 1: ContextRecordSchema is a strict, versioned record —
 * rejects unknown keys, malformed stepId/uuid fields, and non-literal visibility/native
 * fields; toContextRecordSummary derives a lossless projection for the CLI listing view.
 * @architectural-layer Tests
 * @related-files [packages/schemas/src/dogfood_context.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  CONTEXT_RECORD_SCHEMA_VERSION,
  ContextRecordSchema,
  ContextRecordSummarySchema,
  toContextRecordSummary,
} from "@exaix/schemas/dogfood_context.ts";

function validRecordInput() {
  return {
    schemaVersion: CONTEXT_RECORD_SCHEMA_VERSION,
    recordId: "11111111-1111-4111-8111-111111111111",
    executionTraceId: "22222222-2222-4222-8222-222222222222",
    parentTraceId: "33333333-3333-4333-8333-333333333333",
    stepId: "step-1",
    sequence: 1,
    turn: 0,
    attempt: 1,
    surface: "session_delegate_cycle" as const,
    model: "anthropic:claude-sonnet-5",
    timestamp: new Date().toISOString(),
    originalInputSha256: "a".repeat(64),
    promptText: "the exact post-redaction submission",
    promptSha256: "b".repeat(64),
    originalTokenCount: 100,
    finalTokenCount: 80,
    tokenSource: "counted" as const,
    effectiveInputLimit: 16384,
    effectiveReserveLimit: 4096,
    sections: [],
    tools: [],
    visibility: "exaix_submission_only" as const,
    nativePrompt: "unknown" as const,
    nativeTools: "unknown" as const,
    nativeHistory: "unknown" as const,
  };
}

Deno.test("[ContextRecordSchema] parses a valid record", () => {
  const parsed = ContextRecordSchema.parse(validRecordInput());
  assertEquals(parsed.schemaVersion, 1);
  assertEquals(parsed.visibility, "exaix_submission_only");
});

Deno.test("[ContextRecordSchema] rejects an unknown top-level key (strict)", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), extraField: "nope" }));
});

Deno.test("[ContextRecordSchema] rejects a non-UUID recordId", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), recordId: "not-a-uuid" }));
});

Deno.test("[ContextRecordSchema] rejects a stepId with disallowed characters", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), stepId: "step with spaces!" }));
});

Deno.test("[ContextRecordSchema] accepts a stepId at the 256-character boundary", () => {
  const stepId = "a".repeat(256);
  const parsed = ContextRecordSchema.parse({ ...validRecordInput(), stepId });
  assertEquals(parsed.stepId, stepId);
});

Deno.test("[ContextRecordSchema] rejects a stepId over the 256-character limit", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), stepId: "a".repeat(257) }));
});

Deno.test("[ContextRecordSchema] rejects sequence: 0 (must be positive)", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), sequence: 0 }));
});

Deno.test("[ContextRecordSchema] rejects attempt: 0 (must be positive)", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), attempt: 0 }));
});

Deno.test("[ContextRecordSchema] accepts turn: 0 (nonnegative, not positive)", () => {
  const parsed = ContextRecordSchema.parse({ ...validRecordInput(), turn: 0 });
  assertEquals(parsed.turn, 0);
});

Deno.test("[ContextRecordSchema] rejects turn: -1", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), turn: -1 }));
});

Deno.test("[ContextRecordSchema] accepts both surface enum values", () => {
  for (const surface of ["cli_delegate", "session_delegate_cycle"] as const) {
    const parsed = ContextRecordSchema.parse({ ...validRecordInput(), surface });
    assertEquals(parsed.surface, surface);
  }
});

Deno.test("[ContextRecordSchema] rejects an unrecognized surface value", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), surface: "something_else" }));
});

Deno.test("[ContextRecordSchema] rejects a promptSha256 of the wrong length", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), promptSha256: "tooshort" }));
});

Deno.test("[ContextRecordSchema] rejects a visibility value other than exaix_submission_only", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), visibility: "full" }));
});

Deno.test("[ContextRecordSchema] rejects nativePrompt values other than the unknown literal", () => {
  assertThrows(() => ContextRecordSchema.parse({ ...validRecordInput(), nativePrompt: "some captured prompt" }));
});

Deno.test("[ContextRecordSchema] parses a section entry with omitted ids and an unavailable reason", () => {
  const parsed = ContextRecordSchema.parse({
    ...validRecordInput(),
    sections: [{
      label: "portalKnowledgeCrucial",
      allocatorSection: "portalKnowledge",
      allocatedTokens: 2048,
      actualTokens: 0,
      selectedSourceIds: [],
      selectedScores: [],
      unavailableReason: "cold",
      omittedIds: ["chunk-1", "chunk-2"],
      truncated: false,
    }],
  });
  assertEquals(parsed.sections[0].unavailableReason, "cold");
  assertEquals(parsed.sections[0].omittedIds, ["chunk-1", "chunk-2"]);
});

Deno.test("[ContextRecordSchema] rejects an unknown key inside a section entry (strict)", () => {
  assertThrows(() =>
    ContextRecordSchema.parse({
      ...validRecordInput(),
      sections: [{
        label: "x",
        allocatorSection: "x",
        allocatedTokens: 0,
        actualTokens: 0,
        selectedSourceIds: [],
        selectedScores: [],
        omittedIds: [],
        truncated: false,
        extra: "nope",
      }],
    })
  );
});

Deno.test("[ContextRecordSchema] parses a tool entry with schema digest", () => {
  const parsed = ContextRecordSchema.parse({
    ...validRecordInput(),
    tools: [{
      name: "query_relationships",
      description: "Query cached portal relationships.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      schemaDigest: "c".repeat(64),
    }],
  });
  assertEquals(parsed.tools[0].name, "query_relationships");
});

Deno.test("[toContextRecordSummary] projects exactly the summary fields, losslessly", () => {
  const record = ContextRecordSchema.parse(validRecordInput());
  const summary = toContextRecordSummary(record);
  const revalidated = ContextRecordSummarySchema.parse(summary);
  assertEquals(revalidated, {
    recordId: record.recordId,
    executionTraceId: record.executionTraceId,
    parentTraceId: record.parentTraceId,
    stepId: record.stepId,
    sequence: record.sequence,
    turn: record.turn,
    attempt: record.attempt,
    surface: record.surface,
    model: record.model,
    timestamp: record.timestamp,
  });
});
