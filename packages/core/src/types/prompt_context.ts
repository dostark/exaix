/**
 * @module PromptContextTypes
 * @path packages/core/src/types/prompt_context.ts
 * @description Types for structured prompt context (Phase 70).
 * @architectural-layer Shared
 * @related-files ["packages/schemas/src/config.ts", packages/execution/src/agent_runner.ts]
 */

import { z } from "zod";
import { SkillMatchSource, SkillRootKind } from "./enums.ts";

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
/** Trigger fields a skill matched on. Mirrors the schema-owned skill triggers without a runtime dependency on it. */
const ZMatchedTriggers = z.object({
  keywords: z.array(z.string()).optional(),
  task_types: z.array(z.string()).optional(),
  file_patterns: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

/** A validated reference file bundled with a skill. `linked` marks files the body links to. */
const ZSkillReference = z.object({
  path: z.string().min(1),
  content: z.string(),
  linked: z.boolean(),
});

export const ZSkillMatch = z.object({
  /** Validated skill slug. */
  skillId: z.string().min(1),
  /** Content-addressed revision UUID of the exact content injected. */
  revisionId: z.string().uuid(),
  /** SHA-256 of the canonical snapshot the revision id derives from. */
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rootKind: z.nativeEnum(SkillRootKind),
  /** Configured-relative path of the skill folder. */
  sourcePath: z.string().min(1),
  /** Display title. */
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  matchedTriggers: ZMatchedTriggers.default({}),
  source: z.nativeEnum(SkillMatchSource),
  tags: z.array(z.string()).default([]),
  /** Criticality flag carried from the skill so the prompt formatter can render critical
   * skills as a protected segment. */
  critical: z.boolean().default(false),
  /** Minimum effort floor carried from the skill so EffortResolver can raise the resolved
   *  value (floors never lower). */
  effort: z.enum(["low", "medium", "high"]).optional(),
  /** Minimum thinking floor carried from the skill (logical OR of matched floors). */
  thinking: z.boolean().optional(),
  /** Illustrative content split from `content`, carried from `ISkill.examples`. Rendered by
   *  the prompt formatter after Instructions, omitted in trimmed render mode for ordinary
   *  (non-critical) skills. */
  examples: z.string().optional(),
  /** Validated reference files bundled with the skill. */
  references: z.array(ZSkillReference).default([]),
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
