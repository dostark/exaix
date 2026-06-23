/**
 * @module SkillEnvelopeSchema
 * @path packages/schemas/src/skill_envelope.ts
 * @description Zod schema for SKILL.md frontmatter + exaix-block metadata
 *   (the "envelope" that wraps a skill's prose instructions). Designed to be
 *   parsed from YAML frontmatter and a separate `exaix:` block during skill-JSON
 *   generation. The generator (Phase 125 Step 2) then:
 *
 *   Envelope field → Runtime SkillSchema field mapping:
 *     envelope.name                → SkillSchema.name
 *     envelope.description         → SkillSchema.description (required at runtime,
 *                                     generator synthesises a fallback if absent)
 *     envelope.version             → SkillSchema.version (defaults to "1.0.0" if absent)
 *     envelope.scope               → SkillSchema.scope (string; generator always
 *                                     overrides to "global" for .copilot sources — GAP-9)
 *     envelope.skill_id            → SkillSchema.skill_id
 *     envelope.triggers            → SkillSchema.triggers (reuses SkillTriggersSchema shape)
 *     envelope.constraints         → SkillSchema.constraints
 *     envelope.output_requirements → SkillSchema.output_requirements
 *     envelope.quality_criteria    → SkillSchema.quality_criteria (reuses
 *                                     SkillQualityCriterionSchema shape)
 *     envelope.agent               → SkillSchema.compatible_with.agents[0]
 *     envelope.tools               → parsed into the envelope but NOT currently
 *                                     consumed by the generator (no runtime mapping)
 *
 *   Managed fields (synthesised by generator, not in envelope):
 *     id, created_at, source, source_id, status, instructions (from body),
 *     compatible_with (derived from agent/tools), usage_count, derived_from,
 *     effectiveness_score
 *
 * @architectural-layer Shared
 * @dependencies [zod, SkillTriggersSchema, SkillQualityCriterionSchema]
 * @related-files [packages/schemas/src/memory_bank.ts]
 */

import { z } from "zod";
import { SkillQualityCriterionSchema, SkillTriggersSchema } from "./memory_bank.ts";

/**
 * Schema for the SKILL.md envelope — frontmatter fields plus exaix-block fields.
 *
 * Frontmatter fields (from YAML frontmatter):
 *   name, description, version, scope, agent, tools
 *
 * exaix-block fields (from `exaix:` YAML block):
 *   skill_id, triggers, constraints, output_requirements, quality_criteria
 *
 * Both groups are merged into a single zod object because the parser extracts
 * them from the same markdown document and the generator consumes them together.
 */
export const SkillEnvelopeSchema = z.object({
  // === Frontmatter fields ===
  name: z.string().min(1).max(100).describe("Human-readable skill name"),
  description: z.string().optional().describe("Brief description (generator synthesises if absent)"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional()
    .describe("Semantic version (optional in envelope; generator defaults to 1.0.0)"),
  scope: z.string().optional().default("global")
    .describe("Applicability scope string; generator overrides to 'global' for .copilot sources"),

  /** Compatible agent ID (e.g. "senior-coder" or "architect") */
  agent: z.string().optional().describe("Compatible agent ID"),
  /** Required tool names for the skill */
  tools: z.array(z.string()).optional().describe("Required tool names"),

  // === exaix-block fields ===
  skill_id: z.string().regex(/^[a-z0-9-]+$/).describe("Unique skill identifier (kebab-case)"),
  triggers: SkillTriggersSchema.optional().describe("Conditions for automatic activation"),
  constraints: z.array(z.string()).optional().describe("Rules that must be followed"),
  output_requirements: z.array(z.string()).optional().describe("Expected output format/content"),
  quality_criteria: z.array(SkillQualityCriterionSchema).optional()
    .describe("Evaluation criteria"),
});

export type ISkillEnvelope = z.infer<typeof SkillEnvelopeSchema>;
