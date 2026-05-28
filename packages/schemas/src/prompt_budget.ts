/**
 * @module PromptBudgetSchema
 * @path packages/schemas/src/prompt_budget.ts
 * @description Defines Zod schemas and types for model-aware prompt budgeting.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/constants.ts", packages/schemas/src/mod.ts]
 */

import { z } from "zod";
import { DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED, DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED } from "@exaix/core";

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
});

export type IPromptBudgetSections = z.infer<typeof ZPromptBudgetSections>;
export type IPromptBudget = z.infer<typeof ZPromptBudget>;
export type IBudgetPolicy = z.infer<typeof ZBudgetPolicy>;
