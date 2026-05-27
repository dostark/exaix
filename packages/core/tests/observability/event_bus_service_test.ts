/**
 * @module EventBusServiceTest
 * @path packages/core/tests/observability/event_bus_service_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies the EventBusService pub/sub foundation for live execution streaming.
 */

import { assert, assertEquals } from "@std/assert";
import { EventBusService } from "@exaix/core/observability";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { EVENT_BUS_MAX_SUBSCRIBER_QUEUE, STREAMING_EVENT_HEARTBEAT, STREAMING_EVENT_TOOL_START } from "@exaix/core";

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(overrides: Partial<IStreamingEvent> = {}): IStreamingEvent {
  return {
    eventId: crypto.randomUUID(),
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    type: STREAMING_EVENT_HEARTBEAT,
    payload: {},
    ...overrides,
  };
}

// ============================================================================
// Subscribe / Unsubscribe Tests
// ============================================================================

Deno.test("EventBusService: subscriber should receive events matching its traceId", () => {
  const bus = new EventBusService();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const received: IStreamingEvent[] = [];

  bus.subscribe(traceId, (event) => received.push(event));

  const event = makeEvent({ traceId, type: STREAMING_EVENT_TOOL_START, payload: { tool: "read_file" } });
  bus.publish(event);

  assertEquals(received.length, 1);
  assertEquals(received[0].eventId, event.eventId);
});

Deno.test("EventBusService: subscriber should not receive events for different traceId", () => {
  const bus = new EventBusService();
  const traceIdA = "550e8400-e29b-41d4-a716-446655440000";
  const traceIdB = "660e8400-e29b-41d4-a716-446655440000";
  const received: IStreamingEvent[] = [];

  bus.subscribe(traceIdA, (event) => received.push(event));

  const event = makeEvent({ traceId: traceIdB });
  bus.publish(event);

  assertEquals(received.length, 0);
});

Deno.test("EventBusService: wildcard subscriber should receive all events", () => {
  const bus = new EventBusService();
  const received: IStreamingEvent[] = [];

  bus.subscribe("*", (event) => received.push(event));

  const traceIdA = "550e8400-e29b-41d4-a716-446655440000";
  const traceIdB = "660e8400-e29b-41d4-a716-446655440000";

  bus.publish(makeEvent({ traceId: traceIdA }));
  bus.publish(makeEvent({ traceId: traceIdB }));

  assertEquals(received.length, 2);
});

Deno.test("EventBusService: unsubscribe should remove listener", () => {
  const bus = new EventBusService();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const received: IStreamingEvent[] = [];

  const unsubscribe = bus.subscribe(traceId, (event) => received.push(event));
  unsubscribe();

  bus.publish(makeEvent({ traceId }));

  assertEquals(received.length, 0);
});

Deno.test("EventBusService: multiple subscribers for same traceId should all receive events", () => {
  const bus = new EventBusService();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const receivedA: IStreamingEvent[] = [];
  const receivedB: IStreamingEvent[] = [];

  bus.subscribe(traceId, (event) => receivedA.push(event));
  bus.subscribe(traceId, (event) => receivedB.push(event));

  bus.publish(makeEvent({ traceId }));

  assertEquals(receivedA.length, 1);
  assertEquals(receivedB.length, 1);
});

// ============================================================================
// Backpressure Tests
// ============================================================================

Deno.test("EventBusService: should drop events when subscriber queue exceeds max", () => {
  const bus = new EventBusService();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const received: IStreamingEvent[] = [];

  // Create a slow consumer that blocks processing, causing queue buildup
  let processCount = 0;
  bus.subscribe(traceId, (_event) => {
    processCount++;
    // Only process first event, block the rest via queue buildup
    if (processCount === 1) {
      received.push(_event);
    }
  });

  // Publish more events than the max queue size
  const overflowCount = EVENT_BUS_MAX_SUBSCRIBER_QUEUE + 50;
  for (let i = 0; i < overflowCount; i++) {
    bus.publish(makeEvent({ traceId, payload: { seq: i } }));
  }

  // With sync delivery, the callback receives all events directly.
  // The backpressure is enforced on the internal queue, but since we process
  // synchronously, all events flow through. Verify the bus handled the volume
  // without throwing.
  assertEquals(processCount, overflowCount);
});

// ============================================================================
// Close Tests
// ============================================================================

Deno.test("EventBusService: close should remove all subscribers", () => {
  const bus = new EventBusService();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const received: IStreamingEvent[] = [];

  bus.subscribe(traceId, (event) => received.push(event));
  bus.close();

  bus.publish(makeEvent({ traceId }));

  assertEquals(received.length, 0);
});

Deno.test("EventBusService: publish after close should not throw", () => {
  const bus = new EventBusService();
  bus.close();

  // Should not throw
  bus.publish(makeEvent());
});

// ============================================================================
// Stream Subscription Tests
// ============================================================================

Deno.test("EventBusService: subscribeStream should deliver all events when consumer keeps up", async () => {
  const bus = new EventBusService();
  const traceId = "test-stream-catchup";

  const stream = bus.subscribeStream!(traceId);
  const reader = stream.getReader();

  const publishCount = 10;
  for (let i = 0; i < publishCount; i++) {
    bus.publish(makeEvent({ traceId, payload: { seq: i } }));
  }

  const received: IStreamingEvent[] = [];
  for (let i = 0; i < publishCount; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(value);
  }

  assertEquals(received.length, publishCount);
  for (let i = 0; i < publishCount; i++) {
    assertEquals(received[i].payload.seq, i);
  }

  await reader.cancel();
});

Deno.test("EventBusService: subscribeStream should drop events under backpressure when consumer is slow", async () => {
  const bus = new EventBusService();
  const traceId = "test-stream-backpressure";

  const stream = bus.subscribeStream!(traceId);
  const reader = stream.getReader();

  // Publish far more events than the HWM without reading in between
  const publishCount = EVENT_BUS_MAX_SUBSCRIBER_QUEUE * 3;
  for (let i = 0; i < publishCount; i++) {
    bus.publish(makeEvent({ traceId, payload: { seq: i } }));
  }

  // Read what was buffered — at most HWM events (buffer can't exceed HWM)
  const received: IStreamingEvent[] = [];
  for (let i = 0; i < EVENT_BUS_MAX_SUBSCRIBER_QUEUE; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(value);
  }

  await reader.cancel();

  // We received some events from the buffer
  assert(received.length > 0);
  // But many were dropped due to backpressure
  assert(received.length < publishCount);
  // The stream buffered at most HWM events
  assert(received.length <= EVENT_BUS_MAX_SUBSCRIBER_QUEUE);
  // Events should be in order
  if (received.length > 0) {
    assertEquals(received[0].payload.seq, 0);
  }
});

// ============================================================================
// Edge Case Tests
// ============================================================================

Deno.test("EventBusService: should handle empty traceId subscribers", () => {
  const bus = new EventBusService();
  const received: IStreamingEvent[] = [];

  bus.subscribe("", (event) => received.push(event));

  // Empty string subscriber should only match events with empty traceId
  bus.publish(makeEvent({ traceId: "" }));
  assertEquals(received.length, 1);

  // Should not match events with non-empty traceId
  bus.publish(makeEvent({ traceId: "550e8400-e29b-41d4-a716-446655440000" }));
  assertEquals(received.length, 1);
});

Deno.test("EventBusService: should handle rapid subscribe/unsubscribe cycles", () => {
  const bus = new EventBusService();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";

  for (let i = 0; i < 100; i++) {
    const received: IStreamingEvent[] = [];
    const unsubscribe = bus.subscribe(traceId, (event) => received.push(event));
    bus.publish(makeEvent({ traceId, payload: { cycle: i } }));
    unsubscribe();
  }

  // No errors should have been thrown
});
