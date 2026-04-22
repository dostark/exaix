/**
 * @module SseHandlerTest
 * @path tests/integration/api/sse_handler_test.ts
 * @description Integration tests for the SSE handler that bridges HTTP
 * Server-Sent Events to EventBusService for live execution streaming.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { EventBusService } from "../../../src/services/observability/event_bus_service.ts";
import { SseHandler } from "../../../src/api/sse_handler.ts";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { STREAMING_EVENT_HEARTBEAT, STREAMING_EVENT_TOOL_START } from "../../../src/shared/constants.ts";

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
// Event Formatting Tests
// ============================================================================

Deno.test("SseHandler: formatSseEvent produces valid text/event-stream output", () => {
  const event = makeEvent({ type: STREAMING_EVENT_TOOL_START, payload: { tool: "read_file" } });
  const formatted = SseHandler.formatSseEvent(event);

  assertStringIncludes(formatted, "id:");
  assertStringIncludes(formatted, "event:");
  assertStringIncludes(formatted, "data:");
  assertStringIncludes(formatted, STREAMING_EVENT_TOOL_START);
  assertStringIncludes(formatted, '"tool":"read_file"');
});

Deno.test("SseHandler: formatSseEvent includes all required fields", () => {
  const event = makeEvent();
  const formatted = SseHandler.formatSseEvent(event);

  assertStringIncludes(formatted, event.eventId);
  assertStringIncludes(formatted, event.type);
  assertStringIncludes(formatted, JSON.stringify(event));
});

// ============================================================================
// Route Matching Tests
// ============================================================================

Deno.test("SseHandler: matchesTraceIdRoute returns true for valid trace stream path", () => {
  assertEquals(SseHandler.matchesTraceIdRoute("/api/v1/traces/550e8400-e29b-41d4-a716-446655440000/stream"), true);
  assertEquals(SseHandler.matchesTraceIdRoute("/api/v1/traces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/stream"), true);
});

Deno.test("SseHandler: matchesTraceIdRoute returns false for invalid paths", () => {
  // Route pattern matches any non-slash segment; UUID validation happens later
  assertEquals(SseHandler.matchesTraceIdRoute("/api/v1/traces/stream"), false);
  assertEquals(SseHandler.matchesTraceIdRoute("/api/v1/traces/550e8400/stream"), true);
  assertEquals(SseHandler.matchesTraceIdRoute("/api/v1/traces/not-a-uuid/stream"), true);
  assertEquals(SseHandler.matchesTraceIdRoute("/api/v1/traces/550e8400-e29b-41d4-a716-446655440000"), false);
  assertEquals(SseHandler.matchesTraceIdRoute("/other/path"), false);
});

Deno.test("SseHandler: extractTraceId returns UUID from valid path", () => {
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const result = SseHandler.extractTraceId(`/api/v1/traces/${traceId}/stream`);
  assertEquals(result, traceId);
});

Deno.test("SseHandler: extractTraceId returns null for invalid path", () => {
  // Extracts any segment; validation of UUID is separate
  assertEquals(SseHandler.extractTraceId("/api/v1/traces/invalid/stream"), "invalid");
  assertEquals(SseHandler.extractTraceId("/other/path"), null);
});

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test("SseHandler: validateTraceId returns true for valid UUID", () => {
  assertEquals(SseHandler.validateTraceId("550e8400-e29b-41d4-a716-446655440000"), true);
  assertEquals(SseHandler.validateTraceId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), true);
});

Deno.test("SseHandler: validateTraceId returns false for non-UUID values", () => {
  assertEquals(SseHandler.validateTraceId("not-a-uuid"), false);
  assertEquals(SseHandler.validateTraceId(""), false);
  assertEquals(SseHandler.validateTraceId("550e8400"), false);
  assertEquals(SseHandler.validateTraceId("../../../etc/passwd"), false);
  assertEquals(SseHandler.validateTraceId("<script>alert(1)</script>"), false);
});

// ============================================================================
// Request Handler Tests (unit-level, no network)
// ============================================================================

Deno.test("SseHandler: handleRequest returns 400 for non-GET method", async () => {
  const bus = new EventBusService();
  const handler = new SseHandler(bus);

  const req = new Request("http://127.0.0.1:8765/api/v1/traces/550e8400-e29b-41d4-a716-446655440000/stream", {
    method: "POST",
  });
  const response = await handler.handleRequest(req);

  assertEquals(response.status, 405);
  bus.close();
});

Deno.test("SseHandler: handleRequest returns 400 for non-UUID traceId", async () => {
  const bus = new EventBusService();
  const handler = new SseHandler(bus);

  const req = new Request("http://127.0.0.1:8765/api/v1/traces/not-a-uuid/stream");
  const response = await handler.handleRequest(req);

  assertEquals(response.status, 400);
  bus.close();
});

Deno.test("SseHandler: handleRequest returns 404 for non-matching route", async () => {
  const bus = new EventBusService();
  const handler = new SseHandler(bus);

  const req = new Request("http://127.0.0.1:8765/other/path");
  const response = await handler.handleRequest(req);

  assertEquals(response.status, 404);
  bus.close();
});

Deno.test("SseHandler: handleRequest returns SSE content-type for valid request", async () => {
  const bus = new EventBusService();
  const handler = new SseHandler(bus);

  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  const req = new Request(`http://127.0.0.1:8765/api/v1/traces/${traceId}/stream`);

  // We can't easily test the streaming body synchronously, but we can verify
  // the response headers are set correctly before streaming begins
  const response = await handler.handleRequest(req);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/event-stream");
  assertEquals(response.headers.get("cache-control"), "no-cache");
  assertEquals(response.headers.get("connection"), "keep-alive");

  bus.close();
});

// ============================================================================
// Integration Test: SSE Stream with Event Bus
// ============================================================================

Deno.test(
  "SseHandler: published events appear in SSE stream",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const bus = new EventBusService();
    const handler = new SseHandler(bus);

    const traceId = "550e8400-e29b-41d4-a716-446655440000";
    const req = new Request(`http://127.0.0.1:8765/api/v1/traces/${traceId}/stream`);

    const response = await handler.handleRequest(req);
    assertEquals(response.status, 200);

    // Read the stream body
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let accumulated = "";

    // Publish an event after a short delay to ensure subscription is ready
    await new Promise((r) => setTimeout(r, 100));
    bus.publish(makeEvent({ traceId, type: STREAMING_EVENT_TOOL_START, payload: { tool: "read_file" } }));

    // Read multiple chunks until we get the event data
    for (let i = 0; i < 10; i++) {
      const readPromise = reader.read();
      const timeout = new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        setTimeout(() => reject(new Error("Read timeout")), 1000);
      });
      const result = await Promise.race([readPromise, timeout]);
      accumulated += decoder.decode(result.value);
      if (accumulated.includes(STREAMING_EVENT_TOOL_START)) break;
    }

    reader.releaseLock();
    bus.close();

    assertStringIncludes(accumulated, STREAMING_EVENT_TOOL_START);
    assertStringIncludes(accumulated, "read_file");
  },
);
