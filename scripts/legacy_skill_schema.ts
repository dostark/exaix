#!/usr/bin/env -S deno run -A
/**
 * @module LegacySkillSchema
 * @path scripts/legacy_skill_schema.ts
 * @description Transitional copy of the removed compiled-JSON `SkillSchema`, kept only so the
 *   dogfood compiler `generate_skill_json.ts` and its evaluation-baseline tests still build until
 *   the dogfood folder cutover deletes both. No runtime code reads or writes this shape.
 * @architectural-layer Script
 * @dependencies [zod, @exaix/core, @exaix/schemas]
 * @related-files [scripts/generate_skill_json.ts]
 *
 * Usage: imported by generate_skill_json.ts and its tests; not a standalone command.
 */

import { z } from "zod";
import { canonicalizeToolName, McpToolName, MemoryBankSource, MemoryScope, SkillStatus, ToolName } from "@exaix/core";
import { EffortTierSchema } from "@exaix/schemas/model_intent.ts";
import {
  SkillCompatibilitySchema,
  SkillQualityCriterionSchema,
  SkillTriggersSchema,
} from "@exaix/schemas/memory_bank.ts";

export const LegacySkillSchema = z.object({
  // Memory Bank Standard Fields
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  source: z.nativeEnum(MemoryBankSource).describe("Origin of the skill"),
  source_id: z.string().optional().describe("Learning IDs if derived"),

  scope: z.nativeEnum(MemoryScope).describe("Applicability scope"),
  project: z.string().optional().describe("Portal name if project-scoped"),

  status: z.nativeEnum(SkillStatus).describe("Skill lifecycle status"),

  // Skill Identity
  skill_id: z.string().regex(/^[a-z0-9-]+$/).describe("Unique skill identifier (kebab-case)"),
  name: z.string().min(1).max(100).describe("Human-readable skill name"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).describe("Semantic version"),
  description: z.string().describe("Brief description of what the skill does"),

  // Trigger Conditions
  triggers: SkillTriggersSchema.describe("Conditions for automatic activation"),

  // Procedural Knowledge
  instructions: z.string().min(10).describe("The procedural instructions (markdown)"),
  /** Illustrative content split from `instructions` at generation time — managed like
   *  `instructions` itself, never authored directly. */
  examples: z.string().optional().describe(
    "Illustrative content split from instructions at a canonical heading; dropped from the prompt in trimmed render mode",
  ),

  // Constraints and Quality
  constraints: z.array(z.string()).optional().describe("Rules that must be followed"),
  output_requirements: z.array(z.string()).optional().describe("Expected output format/content"),
  quality_criteria: z.array(SkillQualityCriterionSchema).optional().describe("Evaluation criteria"),

  /** When true, the skill renders as a protected prompt segment that survives context-budget pressure. */
  critical: z.boolean().optional().describe(
    "Render as a protected, non-droppable prompt segment (treated as false when absent)",
  ),

  /** Minimum reasoning effort for this skill. A floor never lowers a value. Absent means no floor. */
  effort: EffortTierSchema.optional().describe(
    "Minimum reasoning effort this skill's deliverable requires (floor, not an override)",
  ),
  /** Minimum thinking requirement, same floor semantics as effort. */
  thinking: z.boolean().optional().describe(
    "Whether this skill's deliverable requires extended thinking (floor, not an override)",
  ),

  /** Tools this skill calls for. The agent role's permitted tools still bound them. */
  tools: z.array(
    z.preprocess(
      (value) => typeof value === "string" ? canonicalizeToolName(value) : value,
      z.union([z.nativeEnum(McpToolName), z.nativeEnum(ToolName)]),
    ),
  ).optional().describe(
    "Tools this skill's procedure calls for; unioned across matched skills, then intersected with the agent role's permitted_tools. Supported general-purpose aliases (e.g. grep) resolve to their canonical name; excluded/retired native names fail validation.",
  ),

  // Compatibility
  compatible_with: SkillCompatibilitySchema.optional().describe("Compatibility constraints"),

  // Evolution Tracking
  derived_from: z.array(z.string()).optional().describe("Learning IDs this skill was derived from"),
  effectiveness_score: z.number().min(0).max(100).optional().describe("Measured effectiveness"),
  usage_count: z.number().default(0).describe("Number of times skill has been used"),
});

export type ILegacySkill = z.infer<typeof LegacySkillSchema>;
