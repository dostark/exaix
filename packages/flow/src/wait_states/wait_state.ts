/**
 * @module WaitStateSchemas
 * @path packages/flow/src/wait_states/wait_state.ts
 * @description Zod schemas, types, and event constants for durable wait states.
 * @architectural-layer Contracts
 * @related-files [packages/flow/src/wait_states/, packages/core/src/types/enums.ts]
 *
 * @note no-slow-types is suppressed because Zod schema type inference is intentionally
 *       left implicit. The inferred type is readable via z.infer<typeof ...>.
 */

// deno-lint-ignore-file no-slow-types

import { z } from "zod";

export const WaitStateStatusSchema = z.enum([
  "pending",
  "resumed",
  "fulfilled",
  "rejected",
  "amended",
  "expired",
  "cancelled",
]);

export const WaitStateKindSchema = z.enum([
  "plan_approval",
  "review_approval",
  "clarification",
  "amendment_approval",
]);

export const WaitStateSchema = z.object({
  waitStateId: z.string().uuid(),
  traceId: z.string().min(1),
  kind: WaitStateKindSchema,
  status: WaitStateStatusSchema,
  artifactPath: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deadlineAt: z.string().datetime().optional(),
  resumeToken: z.string().uuid(),
  requestedBy: z.string().min(1).optional(),
  assignedApprover: z.string().min(1).optional(),
  amendmentOf: z.string().uuid().optional(),
  resolutionSummary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type WaitStateStatus = z.infer<typeof WaitStateStatusSchema>;

export type IWaitState = z.infer<typeof WaitStateSchema>;

export const CreateWaitStateInputSchema = z.object({
  kind: WaitStateKindSchema,
  traceId: z.string().min(1),
  artifactPath: z.string().min(1),
  resumeToken: z.string().uuid(),
  requestedBy: z.string().min(1).optional(),
  assignedApprover: z.string().min(1).optional(),
  deadlineAt: z.string().datetime().optional(),
  amendmentOf: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateWaitStateInput = z.infer<typeof CreateWaitStateInputSchema>;

export const TransitionWaitStateInputSchema = z.object({
  waitStateId: z.string().uuid(),
  action: z.enum(["resume", "approve", "reject", "amend", "expire", "cancel"]),
  resumeToken: z.string().uuid(),
  resolutionSummary: z.string().optional(),
});

export type WaitStateAction = "resume" | "approve" | "reject" | "amend" | "expire" | "cancel";

export type TransitionWaitStateInput = z.infer<typeof TransitionWaitStateInputSchema>;
