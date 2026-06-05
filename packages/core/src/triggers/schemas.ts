/**
 * @module TriggerSchemas
 * @path packages/core/src/triggers/schemas.ts
 * @architectural-layer Core
 * @dependencies ["zod"]
 * @related-files ["packages/core/src/triggers/interfaces.ts"]
 * @description Zod schemas for the trigger adapter boundary. Every signal entering
 * Exaix's execution pipeline from a trigger source is normalized into an
 * ExecutionTriggerEnvelope before policy evaluation and dispatch.
 */

import { z } from "zod";
import { MAX_IDEMPOTENCY_KEY_LENGTH } from "./idempotency.ts";

export const TriggerSourceSchema = z.enum([
  "cli",
  "internal_event",
  "webhook",
  "schedule",
  "filesystem",
  "mcp",
]);

export const TriggerActionSchema = z.enum([
  "start_flow",
  "resume_flow",
  "append_signal",
]);

export const ExecutionTriggerEnvelopeSchema = z.object({
  triggerId: z.string().uuid().default(() => crypto.randomUUID()),
  source: TriggerSourceSchema,
  action: TriggerActionSchema,
  idempotencyKey: z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH),
  subject: z.string().min(1),
  traceId: z.string().optional(),
  targetFlowId: z.string().optional(),
  // Intentionally generic — per-adapter validation inside parse()
  payload: z.record(z.string(), z.unknown()).default({}),
  // Intentionally generic — per-adapter validation inside parse()
  metadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

export const TriggerDecisionSchema = z.object({
  accepted: z.boolean(),
  normalizedIntent: z.string().optional(),
  targetFlowId: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export type TTriggerSource = z.infer<typeof TriggerSourceSchema>;
export type TTriggerAction = z.infer<typeof TriggerActionSchema>;
export type ExecutionTriggerEnvelope = z.infer<typeof ExecutionTriggerEnvelopeSchema>;
export type TTriggerDecision = z.infer<typeof TriggerDecisionSchema>;

// No RawTriggerInput alias — each ITriggerAdapter defines its own input shape via generics.
