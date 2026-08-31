/**
 * @module SseHandler
 * @path packages-team/mcp-server/sse_handler.ts
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

/** Heartbeat keep-alive cadence for an open SSE stream. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Default cap on concurrent SSE subscriptions, guarding against local DoS (Finding 13). */
const DEFAULT_MAX_CONCURRENT_STREAMS = 64;

/** Default per-client cap on concurrent SSE subscriptions, keyed by request Host, guarding against local DoS. */
const DEFAULT_MAX_STREAMS_PER_CLIENT = 8;

/** Default idle-disconnect timeout: a stream that has received no non-heartbeat event for this long is closed to release its subscription and slot. */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

export class SseHandler {
  private activeStreams = 0;
  private clientStreamCounts = new Map<string, number>();

  constructor(
    private eventBus: IEventBusService,
    private readonly maxConcurrentStreams: number = DEFAULT_MAX_CONCURRENT_STREAMS,
    private readonly maxStreamsPerClient: number = DEFAULT_MAX_STREAMS_PER_CLIENT,
    private readonly idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  ) {}

  /** Formats an IStreamingEvent as an SSE text block: `id: <eventId>\nevent: <type>\ndata: <json>\n\n`. */
  static formatSseEvent(event: IStreamingEvent): string {
    return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  /**
   * Check if a URL path matches the trace stream route pattern.
   */
  static matchesTraceIdRoute(pathname: string): boolean {
    return TRACE_STREAM_PATTERN.test(pathname);
  }

  /** Extracts the traceId segment from a matching path, or null if the path doesn't match. */
  static extractTraceId(pathname: string): string | null {
    const match = TRACE_STREAM_PATTERN.exec(pathname);
    return match ? match[1] : null;
  }

  /** Validates traceId against the UUID schema; false for any non-UUID value (OWASP A03). */
  static validateTraceId(raw: string): boolean {
    const result = ZStreamingEvent.shape.eventId.safeParse(raw);
    return result.success;
  }

  /** 405 for POST to the stream endpoint, 404 for a non-matching route, 400 for an
   *  invalid traceId, 200 text/event-stream on success. */
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

  /** Bridges HTTP SSE to EventBusService.subscribe with per-client + global concurrency caps and an idle-disconnect timeout; unsubscribes on client disconnect or stream cancellation. */
  private streamEvents(traceId: string, req: Request): Response {
    // Cap concurrent subscriptions to guard against local DoS.
    if (this.activeStreams >= this.maxConcurrentStreams) {
      return new Response("Too many concurrent streams", { status: 429 });
    }
    // Per-client cap: keyed on the request Host so one client cannot exhaust the shared
    // global budget via many parallel streams. Constructed Requests may lack a Host
    // header, so fall back to the URL's host (identical value in real-server cases).
    const clientKey = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
    const clientCount = this.clientStreamCounts.get(clientKey) ?? 0;
    if (clientCount >= this.maxStreamsPerClient) {
      return new Response("Too many concurrent streams for this client", { status: 429 });
    }
    this.activeStreams += 1;
    this.clientStreamCounts.set(clientKey, clientCount + 1);

    let unsubscribe: (() => void) | undefined;
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let idleCheckInterval: ReturnType<typeof setInterval> | undefined;
    let lastActivityAt = Date.now();
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeatInterval !== undefined) clearInterval(heartbeatInterval);
      if (idleCheckInterval !== undefined) clearInterval(idleCheckInterval);
      unsubscribe?.();
      this.activeStreams -= 1;
      const remaining = this.clientStreamCounts.get(clientKey);
      if (remaining !== undefined) {
        if (remaining <= 1) this.clientStreamCounts.delete(clientKey);
        else this.clientStreamCounts.set(clientKey, remaining - 1);
      }
    };

    const stream = new ReadableStream({
      start: (controller) => {
        // Send initial comment/keepalive
        controller.enqueue(new TextEncoder().encode(":\n\n"));

        unsubscribe = this.eventBus.subscribe(traceId, (event: IStreamingEvent) => {
          const data = SseHandler.formatSseEvent(event);
          lastActivityAt = Date.now();
          try {
            controller.enqueue(new TextEncoder().encode(data));
          } catch {
            // Stream already closed — ignore
          }
        });

        // Emit a heartbeat to keep the connection alive (does not reset the idle timer:
        // the timer measures event-less time, not byte-less time).
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(":\n\n"));
          } catch {
            // Stream already closed — ignore
          }
        }, HEARTBEAT_INTERVAL_MS);

        // Idle-disconnect: close a stream that has produced no real event recently,
        // releasing its event-bus subscription and its concurrency slot.
        idleCheckInterval = setInterval(() => {
          if (Date.now() - lastActivityAt >= this.idleTimeoutMs) {
            cleanup();
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        }, Math.min(HEARTBEAT_INTERVAL_MS, this.idleTimeoutMs));

        // Free the subscription + slot on client disconnect.
        req.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }, { once: true });
      },
      // Also free the slot if the stream is cancelled by the consumer.
      cancel: () => cleanup(),
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
