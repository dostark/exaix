/**
 * @module MilestoneEventSchema
 * @path packages/schemas/src/milestone_event.ts
 * @description Zod schema and types for semantic progress milestone events (Phase 92).
 * Milestones are higher-level projections of Phase 87 domain events for UX surfaces.
 * @architectural-layer Schemas
 * @dependencies [@exaix/core]
 * @related-files [packages/core/src/observability/milestone_emitter.ts, packages/schemas/src/streaming_event.ts]
 */

import { z } from "zod";
import {
  MILESTONE_APPROVAL_GATE_ENTERED,
  MILESTONE_APPROVAL_GATE_RESOLVED,
  MILESTONE_CHILD_RUN_COMPLETED,
  MILESTONE_CHILD_RUN_SPAWNED,
  MILESTONE_CONTEXT_COMPACTION_APPLIED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_FAILED,
  MILESTONE_FLOW_STARTED,
  MILESTONE_FLOW_STEP_COMPLETED,
  MILESTONE_FLOW_STEP_REPLAYED,
  MILESTONE_FLOW_STEP_SKIPPED,
  MILESTONE_FLOW_STEP_STARTED,
  MILESTONE_LLM_CALL_COMPLETED,
  MILESTONE_LLM_CALL_STARTED,
  MILESTONE_RESOURCE_LOCK_ACQUIRED,
  MILESTONE_RESOURCE_LOCK_WAITING,
  MILESTONE_TOOL_CALL_COMPLETED,
  MILESTONE_TOOL_CALL_STARTED,
} from "@exaix/core";

export const ExecutionMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  traceId: z.string().min(1),
  milestoneType: z.enum([
    MILESTONE_FLOW_STARTED,
    MILESTONE_FLOW_STEP_STARTED,
    MILESTONE_FLOW_STEP_COMPLETED,
    MILESTONE_FLOW_STEP_REPLAYED,
    MILESTONE_FLOW_STEP_SKIPPED,
    MILESTONE_LLM_CALL_STARTED,
    MILESTONE_LLM_CALL_COMPLETED,
    MILESTONE_TOOL_CALL_STARTED,
    MILESTONE_TOOL_CALL_COMPLETED,
    MILESTONE_CONTEXT_COMPACTION_APPLIED,
    MILESTONE_APPROVAL_GATE_ENTERED,
    MILESTONE_APPROVAL_GATE_RESOLVED,
    MILESTONE_CHILD_RUN_SPAWNED,
    MILESTONE_CHILD_RUN_COMPLETED,
    MILESTONE_RESOURCE_LOCK_WAITING,
    MILESTONE_RESOURCE_LOCK_ACQUIRED,
    MILESTONE_FLOW_COMPLETED,
    MILESTONE_FLOW_FAILED,
  ]),
  requiresAttention: z.boolean().default(false),
  attentionReason: z.string().regex(/^[\x20-\x7E]*$/).optional(),
  progressHint: z.object({
    stepsCompleted: z.number().int().nonnegative().optional(),
    stepsTotal: z.number().int().positive().optional(),
    currentStepLabel: z.string().optional(),
  }).optional(),
  occurredAt: z.string().datetime(),
  summary: z.string().min(1).max(200).regex(/^[\x20-\x7E]*$/),
});

export type IExecutionMilestone = z.infer<typeof ExecutionMilestoneSchema>;
