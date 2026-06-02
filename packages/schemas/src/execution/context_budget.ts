/**
 * @module ContextBudgetSchema
 * @path packages/schemas/src/execution/context_budget.ts
 * @description Zod schemas and TypeScript types for context budget decisions and snapshots.
 * @architectural-layer Schemas
 * @related-files [
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/core/src/types/constants.ts"
 * ]
 */

import { z } from "zod";

export const ContextSegmentKindSchema = z.enum([
  "system",
  "request",
  "acceptance_criteria",
  "plan_step",
  "tool_result",
  "portal_knowledge",
  "reflection",
  "summary",
]);

export const ContextBudgetActionSchema = z.enum([
  "keep",
  "trim",
  "summarize",
  "drop",
  "compress",
]);

export const ContextBudgetDecisionSchema = z.object({
  segmentId: z.string().min(1),
  kind: ContextSegmentKindSchema,
  action: ContextBudgetActionSchema,
  originalTokens: z.number().int().nonnegative(),
  resultingTokens: z.number().int().nonnegative(),
  reason: z.string().min(1),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
});

export const ContextBudgetSnapshotSchema = z.object({
  traceId: z.string().min(1),
  stepId: z.string().min(1),
  model: z.string().min(1),
  maxContextTokens: z.number().int().positive(),
  usedInputTokens: z.number().int().nonnegative(),
  decisions: z.array(ContextBudgetDecisionSchema).default([]),
  overflowRecovered: z.boolean().default(false),
  durationMs: z.number().int().nonnegative().optional(),
});

/** Token estimation backend identifiers. */
export const TOKEN_SOURCE_METHODS = {
  BPE: "bpe",
  HEURISTIC: "heuristic",
} as const;
export type ITokenSource = typeof TOKEN_SOURCE_METHODS[keyof typeof TOKEN_SOURCE_METHODS];

export type IContextSegmentKind = z.infer<typeof ContextSegmentKindSchema>;
export type IContextBudgetAction = z.infer<typeof ContextBudgetActionSchema>;
export type IContextBudgetDecision = z.infer<typeof ContextBudgetDecisionSchema>;
export type IContextBudgetSnapshot = z.infer<typeof ContextBudgetSnapshotSchema>;
