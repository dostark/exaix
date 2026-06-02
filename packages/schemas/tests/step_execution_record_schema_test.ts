/**
 * @module StepExecutionRecordSchemaTest
 * @path packages/schemas/tests/step_execution_record_schema_test.ts
 * @description Validates StepExecutionDispositionSchema, StepIdempotencyKeySchema, and StepExecutionRecordSchema.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ZodError } from "zod";
import { StepExecutionDispositionSchema, StepExecutionRecordSchema, StepIdempotencyKeySchema } from "@exaix/schemas";

Deno.test("StepExecutionDispositionSchema: accepts all valid dispositions", () => {
  const valid = ["executed", "replayed", "skipped_by_reuse", "invalidated"] as const;
  for (const v of valid) {
    assertEquals(StepExecutionDispositionSchema.parse(v), v);
  }
});

Deno.test("StepExecutionDispositionSchema: rejects invalid disposition", () => {
  assertThrows(() => StepExecutionDispositionSchema.parse("unknown"), ZodError);
  assertThrows(() => StepExecutionDispositionSchema.parse(""), ZodError);
});

Deno.test("StepIdempotencyKeySchema: validates valid key", () => {
  const key = {
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    attemptClass: "initial",
    inputHash: "abcdef1234567890",
  };
  const result = StepIdempotencyKeySchema.parse(key);
  assertEquals(result.traceId, "trace-1");
  assertEquals(result.attemptClass, "initial");
});

Deno.test("StepIdempotencyKeySchema: accepts optional toolPolicyHash and portalScopeHash", () => {
  const key = {
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    attemptClass: "retry",
    inputHash: "abcdef1234567890",
    toolPolicyHash: "toolhash1234",
    portalScopeHash: "portalhash1234",
  };
  const result = StepIdempotencyKeySchema.parse(key);
  assertEquals(result.toolPolicyHash, "toolhash1234");
  assertEquals(result.portalScopeHash, "portalhash1234");
});

Deno.test("StepIdempotencyKeySchema: rejects missing required fields", () => {
  assertThrows(() => StepIdempotencyKeySchema.parse({}), ZodError);
  assertThrows(() => StepIdempotencyKeySchema.parse({ traceId: "t" }), ZodError);
});

Deno.test("StepIdempotencyKeySchema: rejects invalid attemptClass", () => {
  assertThrows(
    () =>
      StepIdempotencyKeySchema.parse({
        traceId: "t",
        flowId: "f",
        stepId: "s",
        attemptClass: "invalid",
        inputHash: "abcdef1234567890",
      }),
    ZodError,
  );
});

Deno.test("StepExecutionRecordSchema: validates a minimal valid record", () => {
  const record = {
    recordId: crypto.randomUUID(),
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    idempotencyKey: {
      traceId: "trace-1",
      flowId: "flow-1",
      stepId: "step-1",
      attemptClass: "initial",
      inputHash: "abcdef1234567890",
    },
    disposition: "executed",
    startedAt: new Date().toISOString(),
    inputHash: "abcdef1234567890",
    sideEffectClass: "llm",
    replayEligible: true,
  };
  const result = StepExecutionRecordSchema.parse(record);
  assertEquals(result.recordId, record.recordId);
  assertEquals(result.disposition, "executed");
  assertEquals(result.replayEligible, true);
});

Deno.test("StepExecutionRecordSchema: applies defaults for optional fields", () => {
  const record = {
    recordId: crypto.randomUUID(),
    traceId: "trace-2",
    flowId: "flow-1",
    stepId: "step-1",
    idempotencyKey: {
      traceId: "trace-2",
      flowId: "flow-1",
      stepId: "step-1",
      attemptClass: "resume",
      inputHash: "deadbeef12345678",
    },
    disposition: "replayed",
    startedAt: new Date().toISOString(),
    inputHash: "deadbeef12345678",
    sideEffectClass: "none",
    replayEligible: false,
  };
  const result = StepExecutionRecordSchema.parse(record);
  assertEquals(result.metadata, {});
});

Deno.test("StepExecutionRecordSchema: rejects invalid disposition value", () => {
  assertThrows(
    () =>
      StepExecutionRecordSchema.parse({
        recordId: crypto.randomUUID(),
        traceId: "t",
        flowId: "f",
        stepId: "s",
        idempotencyKey: {
          traceId: "t",
          flowId: "f",
          stepId: "s",
          attemptClass: "initial",
          inputHash: "abcdef1234567890",
        },
        disposition: "not_a_disposition",
        startedAt: new Date().toISOString(),
        inputHash: "abcdef1234567890",
        sideEffectClass: "llm",
        replayEligible: true,
      }),
    ZodError,
  );
});

Deno.test("StepExecutionRecordSchema: rejects missing required fields", () => {
  assertThrows(() => StepExecutionRecordSchema.parse({}), ZodError);
  assertThrows(() => StepExecutionRecordSchema.parse({ recordId: crypto.randomUUID() }), ZodError);
});

Deno.test("StepExecutionRecordSchema: rejects invalid sideEffectClass", () => {
  assertThrows(
    () =>
      StepExecutionRecordSchema.parse({
        recordId: crypto.randomUUID(),
        traceId: "t",
        flowId: "f",
        stepId: "s",
        idempotencyKey: {
          traceId: "t",
          flowId: "f",
          stepId: "s",
          attemptClass: "initial",
          inputHash: "abcdef1234567890",
        },
        disposition: "executed",
        startedAt: new Date().toISOString(),
        inputHash: "abcdef1234567890",
        sideEffectClass: "invalid",
        replayEligible: true,
      }),
    ZodError,
  );
});

Deno.test("StepExecutionRecordSchema: accepts all valid sideEffectClass values", () => {
  const validClasses = ["none", "llm", "tool", "git", "mixed"] as const;
  for (const cls of validClasses) {
    const record = {
      recordId: crypto.randomUUID(),
      traceId: "t",
      flowId: "f",
      stepId: "s",
      idempotencyKey: {
        traceId: "t",
        flowId: "f",
        stepId: "s",
        attemptClass: "initial",
        inputHash: "abcdef1234567890",
      },
      disposition: "executed",
      startedAt: new Date().toISOString(),
      inputHash: "abcdef1234567890",
      sideEffectClass: cls,
      replayEligible: false,
    };
    assertEquals(StepExecutionRecordSchema.parse(record).sideEffectClass, cls);
  }
});
