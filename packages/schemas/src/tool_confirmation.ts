/**
 * @module ToolConfirmationSchema
 * @path packages/schemas/src/tool_confirmation.ts
 * @description Zod schemas and TypeScript types for the Phase 79 Tool Confirmation
 * Interceptor: ToolConfirmationRequest (the pause/ask payload) and
 * ToolConfirmationDecision (the human or timeout response).
 * @architectural-layer Shared
 * @ungrounded
 * @dependencies ["zod"]
 * @related-files [packages/core/src/types/tool_confirmation_interceptor.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import { z } from "zod";

export const ToolConfirmationRequestSchema = z.object({
  id: z.string().uuid("Confirmation request ID must be a valid UUID"),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  stepId: z.string().min(1),
  traceId: z.string().min(1),
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const ToolConfirmationDecisionSchema = z.object({
  id: z.string().uuid("Decision ID must be a valid UUID"),
  approved: z.boolean(),
  reason: z.string().optional(),
  decidedAt: z.string().datetime(),
  decidedBy: z.string().optional(),
});

export type ToolConfirmationRequest = z.infer<typeof ToolConfirmationRequestSchema>;
export type ToolConfirmationDecision = z.infer<typeof ToolConfirmationDecisionSchema>;
