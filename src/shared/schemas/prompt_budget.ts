/**
 * @module PromptBudgetSchema
 * @path src/shared/schemas/prompt_budget.ts
 * @description Defines Zod schemas and types for model-aware prompt budgeting.
 * @architectural-layer Shared
 * @related-files [src/shared/constants.ts, src/shared/schemas/mod.ts]
 */

import { z } from "zod";

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

export type IPromptBudgetSections = z.infer<typeof ZPromptBudgetSections>;
export type IPromptBudget = z.infer<typeof ZPromptBudget>;
