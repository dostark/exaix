/**
 * @module EventRegistry
 * @path packages/core/src/events/event_registry.ts
 * @architectural-layer Core
 * @dependencies ["packages/core/src/logger/event_logger.ts"]
 * @related-files ["packages/core/src/events/domain_event_types.ts", "packages/core/src/logger/event_logger.ts"]
 * @description Validates event sources at emission time by checking that each
 * sourceId is registered for the event type it is emitting. Delegates to
 * EventLogger after validation — no new emission path.
 */

import type { IEventLogger } from "../logger/event_logger.ts";
import type { TDomainEventType } from "./domain_event_types.ts";
import type { LogMetadata } from "../types/json.ts";

export interface IEventRegistry {
  registerPublisher(sourceId: string, eventTypes: readonly TDomainEventType[]): void;
  emit(sourceId: string, eventType: TDomainEventType, payload?: LogMetadata): Promise<void>;
  registeredPublishers(): ReadonlyMap<string, ReadonlySet<TDomainEventType>>;
}

export class EventRegistry implements IEventRegistry {
  private readonly publishers = new Map<string, Set<TDomainEventType>>();
  private readonly logger: IEventLogger;

  constructor(logger: IEventLogger) {
    this.logger = logger;
  }

  registerPublisher(sourceId: string, eventTypes: readonly TDomainEventType[]): void {
    const set = new Set(eventTypes);
    this.publishers.set(sourceId, set);
  }

  async emit(sourceId: string, eventType: TDomainEventType, payload?: LogMetadata): Promise<void> {
    const allowed = this.publishers.get(sourceId);
    if (!allowed) {
      throw new Error(`Event source "${sourceId}" is not registered`);
    }
    if (!allowed.has(eventType)) {
      throw new Error(
        `Event type "${eventType}" is not registered for source "${sourceId}"`,
      );
    }
    await this.logger.info(eventType, sourceId, payload);
  }

  registeredPublishers(): ReadonlyMap<string, ReadonlySet<TDomainEventType>> {
    return this.publishers;
  }
}
