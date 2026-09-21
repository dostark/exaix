/**
 * @module PromptBudgetSchema
 * @path packages/schemas/src/prompt_budget.ts
 * @description Defines Zod schemas and types for model-aware prompt budgeting.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/constants.ts", packages/schemas/src/mod.ts]
 */

import { z } from "zod";
import { DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED, DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED } from "@exaix/core";

/** One segment's breakdown in a non-mutating `AgentRunner.previewPrompt()` result. */
export interface IPromptPreviewSegment {
  segmentId: string;
  kind: string;
  priority: number;
  tokenEstimate: number;
  byteLength: number;
  nonCompactable: boolean;
  /** Whether this segment survived `ContextBudgetManager.prepare()` into the final prompt. */
  included: boolean;
}

/** Real per-segment token/priority/inclusion breakdown for a request's planning-call
 *  prompt, computed without invoking the LLM. Shares `AgentRunner`'s real segment-assembly
 *  logic with `constructPrompt` — never a forked estimate. */
export interface IPromptPreview {
  segments: IPromptPreviewSegment[];
  totalTokenEstimate: number;
  budgetTotalTokens: number;
  /** True when at least one segment present in the full assembly did not survive into
   *  the final prompt (dropped or trimmed under budget pressure). */
  compactionTriggered: boolean;
  matchedSkillIds: string[];
  /** Prompt-only cost estimate from the real per-model pricing table; `undefined` when
   *  the model has no known pricing overlay entry — never a fabricated figure. */
  estimatedCostUsd?: number;
}

export enum PromptBudgetSection {
  SYSTEM = "system",
  PLAN = "plan",
  PORTAL_KNOWLEDGE = "portalKnowledge",
  MEMORY = "memory",
  SKILLS = "skills",
  LOOP_HISTORY = "loopHistory",
}

export const ZPromptBudgetSections = z.object({
  [PromptBudgetSection.SYSTEM]: z.number().int().nonnegative(),
  [PromptBudgetSection.PLAN]: z.number().int().nonnegative(),
  [PromptBudgetSection.PORTAL_KNOWLEDGE]: z.number().int().nonnegative(),
  [PromptBudgetSection.MEMORY]: z.number().int().nonnegative(),
  [PromptBudgetSection.SKILLS]: z.number().int().nonnegative(),
  [PromptBudgetSection.LOOP_HISTORY]: z.number().int().nonnegative(),
});

export const ZPromptBudget = z.object({
  model: z.string().min(1),
  totalBudgetTokens: z.number().int().positive(),
  safetyBufferTokens: z.number().int().nonnegative(),
  sections: ZPromptBudgetSections,
});

/** Runtime policy that controls budget enforcement by provider category. */
export const ZBudgetPolicy = z.object({
  cloud: z.boolean().default(DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED),
  local: z.boolean().default(DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED),
  /** When set, overrides per-provider cloud/local sub-fields. */
  enabled: z.boolean().optional(),
  /** Optional hard cap on assembled prompt tokens per request, independent of the
   *  model's context window — for cost control on large-context models where overflow
   *  is not the risk. When unset, behavior is unchanged (context-window-derived only). */
  costTargetTokens: z.number().int().positive().optional(),
});

export type IPromptBudgetSections = z.infer<typeof ZPromptBudgetSections>;
export type IPromptBudget = z.infer<typeof ZPromptBudget>;
export type IBudgetPolicy = z.infer<typeof ZBudgetPolicy>;
