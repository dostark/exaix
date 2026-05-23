/**
 * @module EventBusService
 * @path packages/core/src/observability/event_bus_service.ts
 * @description In-memory pub/sub event bus for live execution streaming.
 * Subscribers are mapped by traceId with wildcard support. Backpressure drops
 * events when a subscriber queue exceeds EVENT_BUS_MAX_SUBSCRIBER_QUEUE.
 * @architectural-layer Services
 * @dependencies [src/shared/constants.ts, src/shared/schemas/streaming_event.ts]
 * @related-files [packages/core/src/logger/event_logger.ts, packages/mcp/server/sse_handler.ts]
 */

import { EVENT_BUS_MAX_SUBSCRIBER_QUEUE } from "@exaix/core";
import type { IStreamingEvent } from "@exaix/schemas";

type ISubscriberCallback = (event: IStreamingEvent) => void;

interface ISubscriberEntry {
  callback: ISubscriberCallback;
  queue: IStreamingEvent[];
  isProcessing: boolean;
}

export interface IEventBusService {
  publish(event: IStreamingEvent): void;
  subscribe(traceId: string, callback: (event: IStreamingEvent) => void): () => void;
  close(): void;
}

/**
 * In-memory event bus that routes events to subscribers by traceId.
 * Supports wildcard (`*`) subscriptions for daemon-wide monitoring.
 * Implements backpressure by dropping events when a subscriber's queue
 * exceeds EVENT_BUS_MAX_SUBSCRIBER_QUEUE entries.
 */
export class EventBusService implements IEventBusService {
  private static instance: EventBusService | null = null;

  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  static resetInstance(): void {
    EventBusService.instance = null;
  }

  private readonly subscribers = new Map<string, Set<ISubscriberEntry>>();
  private closed = false;

  publish(event: IStreamingEvent): void {
    if (this.closed) return;

    const { traceId } = event;

    // Deliver to trace-specific subscribers
    this.deliverToGroup(traceId, event);

    // Deliver to wildcard subscribers
    this.deliverToGroup("*", event);
  }

  subscribe(traceId: string, callback: ISubscriberCallback): () => void {
    if (this.closed) return () => {};

    const entry: ISubscriberEntry = {
      callback,
      queue: [],
      isProcessing: false,
    };

    let group = this.subscribers.get(traceId);
    if (!group) {
      group = new Set();
      this.subscribers.set(traceId, group);
    }
    group.add(entry);

    return () => {
      group.delete(entry);
      if (group.size === 0) {
        this.subscribers.delete(traceId);
      }
    };
  }

  close(): void {
    this.closed = true;
    this.subscribers.clear();
  }

  private deliverToGroup(traceId: string, event: IStreamingEvent): void {
    const group = this.subscribers.get(traceId);
    if (!group) return;

    for (const entry of group) {
      this.deliverToSubscriber(entry, event);
    }
  }

  private deliverToSubscriber(entry: ISubscriberEntry, event: IStreamingEvent): void {
    // Backpressure: drop if queue is full
    if (entry.queue.length >= EVENT_BUS_MAX_SUBSCRIBER_QUEUE) {
      return;
    }

    entry.queue.push(event);

    // Process queue if not already processing
    if (entry.isProcessing) return;
    entry.isProcessing = true;

    while (entry.queue.length > 0) {
      const next = entry.queue.shift();
      if (!next) break;
      try {
        entry.callback(next);
      } catch {
        // Subscriber callback threw — continue with remaining events
      }
    }

    entry.isProcessing = false;
  }
}
