/**
 * @module PromptContextTypes
 * @path packages/core/src/types/prompt_context.ts
 * @description Types for structured prompt context (Phase 70).
 * @architectural-layer Shared
 * @related-files ["packages/schemas/src/config.ts", packages/execution/src/agent_runner.ts]
 */

import { z } from "zod";

/**
 * Structured context for agent prompt construction
 */
export interface IAgentPromptContext {
  systemPrompt: string;
  memoryContext: string | null;
  skillsContext: ISkillsContext | null;
  portalKnowledge: string | null;
  userRequest: string;
}

/**
 * Skill match result for prompt injection
 */
export const ZSkillMatch = z.object({
  skillId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  matchScore: z.number().min(0).max(1),
  tags: z.array(z.string()).default([]),
  /** Criticality flag carried from the skill so the prompt formatter can render critical
   * skills as a protected segment. */
  critical: z.boolean().default(false),
});

/**
 * Context for matched skills in a request
 */
export const ZSkillsContext = z.object({
  matched: z.array(ZSkillMatch),
  totalAvailable: z.number().int().min(0),
  retrievalLatencyMs: z.number().int().min(0),
});

export type ISkillsContext = z.infer<typeof ZSkillsContext>;
