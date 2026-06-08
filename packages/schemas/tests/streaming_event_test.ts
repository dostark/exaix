/**
 * @module StreamingEventSchemaTest
 * @path packages/schemas/tests/streaming_event_test.ts
 * @description Schema validation tests for ZStreamingEvent including milestone type support
 * @architectural-layer Testing
 * @ungrounded
 */

import { assertEquals } from "@std/assert";
import { ZStreamingEvent } from "@exaix/schemas";
import { MILESTONE_FLOW_STEP_STARTED, STREAMING_EVENT_MILESTONE } from "@exaix/core";

Deno.test("ZStreamingEvent - accepts milestone type", () => {
  const result = ZStreamingEvent.safeParse({
    eventId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    type: STREAMING_EVENT_MILESTONE,
    payload: { milestoneType: MILESTONE_FLOW_STEP_STARTED, summary: "Step started" },
  });
  assertEquals(result.success, true);
});

Deno.test("ZStreamingEvent - milestone payload carries milestoneType and summary", () => {
  const result = ZStreamingEvent.safeParse({
    eventId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    type: STREAMING_EVENT_MILESTONE,
    payload: {
      milestoneType: MILESTONE_FLOW_STEP_STARTED,
      summary: "Step 1 started",
      requiresAttention: false,
      progressHint: { stepsCompleted: 0, stepsTotal: 3, currentStepLabel: "Step 1" },
    },
  });
  assertEquals(result.success, true);
});

Deno.test("ZStreamingEvent - rejects unknown event type", () => {
  const result = ZStreamingEvent.safeParse({
    eventId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    type: "unknown.type",
    payload: {},
  });
  assertEquals(result.success, false);
});
