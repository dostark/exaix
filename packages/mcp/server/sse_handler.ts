/**
 * @module SseHandler
 * @path packages/mcp/server/sse_handler.ts
 * @description Local SSE endpoint that bridges HTTP Server-Sent Events to
 * EventBusService.subscribe. Binds to 127.0.0.1 only for security.
 * Validates traceId against z.string().uuid() before subscribing.
 * @architectural-layer API
 * @dependencies [packages/core/src/observability/event_bus_service.ts, src/shared/schemas/streaming_event.ts]
 * @related-files [packages/core/src/logger/event_logger.ts, apps/exactl/src/commands/watch.ts]
 */

import type { IEventBusService } from "@exaix/core/observability";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { ZStreamingEvent } from "@exaix/schemas/streaming_event.ts";

const TRACE_STREAM_PATTERN = /^\/api\/v1\/traces\/([^/]+)\/stream$/;

export class SseHandler {
  constructor(private eventBus: IEventBusService) {}

  /**
   * Format an IStreamingEvent as a well-formed SSE text block.
   * Output: id: <eventId>\nevent: <type>\ndata: <json>\n\n
   */
  static formatSseEvent(event: IStreamingEvent): string {
    return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  /**
   * Check if a URL path matches the trace stream route pattern.
   */
  static matchesTraceIdRoute(pathname: string): boolean {
    return TRACE_STREAM_PATTERN.test(pathname);
  }

  /**
   * Extract the traceId segment from a matching path.
   * Returns null if the path doesn't match the pattern.
   */
  static extractTraceId(pathname: string): string | null {
    const match = TRACE_STREAM_PATTERN.exec(pathname);
    return match ? match[1] : null;
  }

  /**
   * Validate a traceId string against the UUID schema.
   * Returns false for any non-UUID value (security: OWASP A03).
   */
  static validateTraceId(raw: string): boolean {
    const result = ZStreamingEvent.shape.eventId.safeParse(raw);
    return result.success;
  }

  /**
   * Handle an incoming HTTP request.
   * - POST to stream endpoint → 405
   * - Non-matching route → 404
   * - Invalid traceId → 400
   * - Valid GET → 200 text/event-stream with live subscription
   */
  handleRequest(req: Request): Response {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only allow GET for stream endpoint
    if (req.method !== "GET" && SseHandler.matchesTraceIdRoute(pathname)) {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!SseHandler.matchesTraceIdRoute(pathname)) {
      return new Response("Not found", { status: 404 });
    }

    const rawTraceId = SseHandler.extractTraceId(pathname);
    if (!rawTraceId || !SseHandler.validateTraceId(rawTraceId)) {
      return new Response(
        JSON.stringify({ error: "Invalid traceId: must be a valid UUID" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return this.streamEvents(rawTraceId, req);
  }

  /**
   * Bridge HTTP SSE to EventBusService.subscribe.
   * Unsubscribes on client disconnect (req.signal abort).
   */
  private streamEvents(traceId: string, req: Request): Response {
    const stream = new ReadableStream({
      start: (controller) => {
        // Send initial comment/keepalive
        controller.enqueue(new TextEncoder().encode(":\n\n"));

        const unsubscribe = this.eventBus.subscribe(traceId, (event: IStreamingEvent) => {
          const data = SseHandler.formatSseEvent(event);
          try {
            controller.enqueue(new TextEncoder().encode(data));
          } catch {
            // Stream already closed — ignore
          }
        });

        // Unsubscribe on client disconnect
        req.signal.addEventListener("abort", () => {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}
