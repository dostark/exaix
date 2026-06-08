/**
 * @module MilestoneEventBusBridgeTest
 * @path packages/core/tests/observability/milestone_event_bus_bridge_test.ts
 * @description Tests for MilestoneEventBusEmitter that bridges IExecutionMilestone
 * to IStreamingEvent via EventBusService
 * @architectural-layer Testing
 * @ungrounded
 */

import { assertEquals } from "@std/assert";
import { EventBusService, MilestoneEventBusEmitter } from "@exaix/core/observability";
import {
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_STARTED,
  MILESTONE_FLOW_STEP_STARTED,
  STREAMING_EVENT_MILESTONE,
} from "@exaix/core";
import type { IExecutionMilestone } from "@exaix/schemas";

function makeMilestone(overrides: Partial<IExecutionMilestone> = {}): IExecutionMilestone {
  return {
    milestoneId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    milestoneType: MILESTONE_FLOW_STARTED,
    requiresAttention: false,
    occurredAt: new Date().toISOString(),
    summary: "Flow started",
    ...overrides,
  };
}

Deno.test("MilestoneEventBusEmitter: publishes milestone as streaming event", async () => {
  const bus = new EventBusService();
  const emitter = new MilestoneEventBusEmitter(bus);

  const received: Array<{ milestoneType: string; summary: string }> = [];
  const unsub = bus.subscribe("550e8400-e29b-41d4-a716-446655440000", (event) => {
    if (event.type === STREAMING_EVENT_MILESTONE) {
      received.push({
        milestoneType: event.payload.milestoneType as string,
        summary: event.payload.summary as string,
      });
    }
  });

  const milestone = makeMilestone();
  await emitter.emit(milestone);

  bus.close();
  unsub();

  assertEquals(received.length, 1, "should have received 1 milestone event");
  assertEquals(received[0].milestoneType, MILESTONE_FLOW_STARTED);
  assertEquals(received[0].summary, "Flow started");
});

Deno.test("MilestoneEventBusEmitter: publishes each emitted milestone", async () => {
  const bus = new EventBusService();
  const emitter = new MilestoneEventBusEmitter(bus);

  const received: Array<{ milestoneType: string; summary: string }> = [];
  const unsub = bus.subscribe("550e8400-e29b-41d4-a716-446655440000", (event) => {
    if (event.type === STREAMING_EVENT_MILESTONE) {
      received.push({
        milestoneType: event.payload.milestoneType as string,
        summary: event.payload.summary as string,
      });
    }
  });

  await emitter.emit(makeMilestone({ milestoneType: MILESTONE_FLOW_STEP_STARTED, summary: "Step 1 started" }));
  await emitter.emit(makeMilestone({ milestoneType: MILESTONE_FLOW_COMPLETED, summary: "Flow completed" }));

  bus.close();
  unsub();

  assertEquals(received.length, 2);
  assertEquals(received[0].milestoneType, MILESTONE_FLOW_STEP_STARTED);
  assertEquals(received[1].milestoneType, MILESTONE_FLOW_COMPLETED);
});

Deno.test("MilestoneEventBusEmitter: streaming event carries correct type and traceId", async () => {
  const bus = new EventBusService();
  const emitter = new MilestoneEventBusEmitter(bus);

  const received: { type: string; traceId: string }[] = [];
  const unsub = bus.subscribe("550e8400-e29b-41d4-a716-446655440000", (event) => {
    received.push({ type: event.type, traceId: event.traceId });
  });

  const milestone = makeMilestone();
  await emitter.emit(milestone);

  bus.close();
  unsub();

  assertEquals(received.length, 1);
  assertEquals(received[0].type, STREAMING_EVENT_MILESTONE);
  assertEquals(received[0].traceId, "550e8400-e29b-41d4-a716-446655440000");
});

Deno.test("MilestoneEventBusEmitter: streaming event includes full milestone payload", async () => {
  const bus = new EventBusService();
  const emitter = new MilestoneEventBusEmitter(bus);

  const received: Array<
    { milestoneType: string; requiresAttention: boolean; attentionReason?: string; summary: string }
  > = [];
  const unsub = bus.subscribe("550e8400-e29b-41d4-a716-446655440000", (event) => {
    if (event.type === STREAMING_EVENT_MILESTONE) {
      received.push({
        milestoneType: event.payload.milestoneType as string,
        requiresAttention: event.payload.requiresAttention as boolean,
        attentionReason: event.payload.attentionReason as string | undefined,
        summary: event.payload.summary as string,
      });
    }
  });

  const milestone = makeMilestone({
    milestoneType: MILESTONE_FLOW_STEP_STARTED,
    requiresAttention: true,
    attentionReason: "Approval needed",
    summary: "Step started, needs approval",
    progressHint: { stepsCompleted: 1, stepsTotal: 3, currentStepLabel: "Step 2" },
  });
  await emitter.emit(milestone);

  bus.close();
  unsub();

  assertEquals(received.length, 1);
  assertEquals(received[0].milestoneType, MILESTONE_FLOW_STEP_STARTED);
  assertEquals(received[0].requiresAttention, true);
  assertEquals(received[0].attentionReason, "Approval needed");
  assertEquals(received[0].summary, "Step started, needs approval");
});

Deno.test("MilestoneEventBusEmitter: handles wildcard subscribers", async () => {
  const bus = new EventBusService();
  const emitter = new MilestoneEventBusEmitter(bus);

  const received: string[] = [];
  const unsub = bus.subscribe("*", (event) => {
    if (event.type === STREAMING_EVENT_MILESTONE) {
      received.push(event.payload.milestoneType as string);
    }
  });

  await emitter.emit(makeMilestone());

  bus.close();
  unsub();

  assertEquals(received.length, 1);
  assertEquals(received[0], MILESTONE_FLOW_STARTED);
});
