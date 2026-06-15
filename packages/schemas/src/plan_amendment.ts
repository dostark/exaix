/**
 * @module PlanAmendmentSchema
 * @path packages/schemas/src/plan_amendment.ts
 * @description Zod schemas and TypeScript types for mid-execution plan amendments.
 * @architectural-layer Shared
 * @related-files [packages/core/src/planning/plan_amendment_service.ts]
 */

import { z } from "zod";

/**
 * Trigger that initiates an amendment proposal
 */
export const ZPlanAmendmentTrigger = z.object({
  source: z.enum(["tool_error", "low_confidence", "context_mismatch", "manual_request", "guardrail_violation"]),
  stepId: z.string(),
  reason: z.string().min(1),
  confidenceScore: z.number().min(0).max(100).optional(),
  toolName: z.string().optional(),
});

export type IPlanAmendmentTrigger = z.infer<typeof ZPlanAmendmentTrigger>;

/**
 * A patch defining changes to the remaining steps of a plan
 */
export const ZPlanAmendmentPatch = z.object({
  amendmentId: z.string().uuid(),
  planId: z.string(),
  affectedRemainingStepIds: z.array(z.string()).min(1),
  summary: z.string().min(1),
  adds: z.array(z.object({
    number: z.number().int().min(1),
    title: z.string().min(1),
    content: z.string(),
  })).default([]),
  updates: z.array(z.object({
    number: z.number().int().min(1),
    title: z.string().min(1),
    content: z.string(),
  })).default([]),
  removes: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type IPlanAmendmentPatch = z.infer<typeof ZPlanAmendmentPatch>;

/**
 * A decision on a proposed plan amendment
 */
export const ZPlanAmendmentDecision = z.object({
  amendmentId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "expired"]),
  decidedAt: z.string().datetime(),
  decidedBy: z.string().min(1),
  rationale: z.string().optional(),
});

export type IPlanAmendmentDecision = z.infer<typeof ZPlanAmendmentDecision>;
