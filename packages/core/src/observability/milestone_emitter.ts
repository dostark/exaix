/**
 * @module MilestoneEmitter
 * @path packages/core/src/observability/milestone_emitter.ts
 * @description IMilestoneEmitter interface and NoopMilestoneEmitter for semantic
 * progress milestone events (Phase 92). Milestones are higher-level projections
 * of domain events for operator-facing UX surfaces.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/milestone_event.ts, packages/flow/src/flow_runner.ts, packages/execution/src/agent_runner.ts]
 */

import type { IExecutionMilestone } from "@exaix/schemas";
import { STREAMING_EVENT_MILESTONE } from "../types/constants.ts";
import type { IEventBusService } from "./event_bus_service.ts";
import type { IStreamingEvent } from "@exaix/schemas";

export interface IMilestoneEmitter {
  emit(milestone: IExecutionMilestone): Promise<void>;
}

export class NoopMilestoneEmitter implements IMilestoneEmitter {
  async emit(_milestone: IExecutionMilestone): Promise<void> {
    // No-op: milestone streaming is disabled or not configured
  }
}

export class MilestoneEventBusEmitter implements IMilestoneEmitter {
  constructor(private bus: IEventBusService) {}

  emit(milestone: IExecutionMilestone): Promise<void> {
    const streamingEvent = {
      eventId: crypto.randomUUID(),
      traceId: milestone.traceId,
      timestamp: new Date().toISOString(),
      type: STREAMING_EVENT_MILESTONE,
      payload: {
        milestoneId: milestone.milestoneId,
        traceId: milestone.traceId,
        milestoneType: milestone.milestoneType,
        requiresAttention: milestone.requiresAttention,
        attentionReason: milestone.attentionReason,
        progressHint: milestone.progressHint,
        occurredAt: milestone.occurredAt,
        summary: milestone.summary,
      },
    } satisfies IStreamingEvent;
    this.bus.publish(streamingEvent);
    return Promise.resolve();
  }
}
