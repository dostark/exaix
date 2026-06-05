/**
 * @module InternalEventAdapter
 * @path packages/triggers/adapters/internal_event_adapter.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers"]
 * @related-files []
 * @ungrounded
 * @description Trigger adapter for internal Exaix domain events. Converts
 * DomainEventType events into ExecutionTriggerEnvelope with source "internal_event"
 * and action "append_signal" by default.
 */

import type { ExecutionTriggerEnvelope, ITriggerAdapter } from "@exaix/core/triggers";
import { normalizeIdempotencyKey } from "@exaix/core/triggers";

interface IInternalEventInput {
  eventType?: string;
  flowId?: string;
  stepId?: string;
}

export class InternalEventAdapter implements ITriggerAdapter<IInternalEventInput> {
  readonly source = "internal_event" as const;

  parse(rawInput: IInternalEventInput): Promise<ExecutionTriggerEnvelope> {
    const eventType = rawInput.eventType ?? "unknown";
    const subject = eventType;
    return Promise.resolve({
      triggerId: crypto.randomUUID(),
      source: "internal_event",
      action: "append_signal",
      idempotencyKey: normalizeIdempotencyKey(
        `internal-${eventType}-${rawInput.flowId ?? "none"}`,
      ),
      subject,
      payload: { eventType, flowId: rawInput.flowId, stepId: rawInput.stepId },
      metadata: {},
      occurredAt: new Date().toISOString(),
    });
  }
}
