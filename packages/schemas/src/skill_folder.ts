/**
 * @module SkillFolderSchema
 * @path packages/schemas/src/skill_folder.ts
 * @description Zod schemas for the Agent Skills folder format: strict `SKILL.md`
 *   frontmatter and the Exaix-only `exaix.yaml` sidecar. The runtime projection of
 *   both lives in `runtime_skill.ts`. Runtime roots reject any frontmatter key the
 *   Agent Skills specification does not allow; the dogfood root validates the named
 *   knowledge-base exceptions separately.
 * @architectural-layer Schemas
 * @dependencies [zod, @exaix/core, ./memory_bank.ts, ./model_intent.ts]
 * @related-files [packages/schemas/src/runtime_skill.ts, packages/core/src/skills/skill_snapshot.ts]
 */

import { z } from "zod";
import { canonicalizeToolName, McpToolName, SkillStatus, ToolName } from "@exaix/core";
import { SkillQualityCriterionSchema, SkillTriggersSchema } from "./memory_bank.ts";
import { EffortTierSchema } from "./model_intent.ts";

/** Spec slug: lowercase ASCII alphanumerics in single-hyphen-separated groups, 1-64 characters. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500;

/** Frontmatter `metadata` is a flat string-to-string map per the Agent Skills spec. */
export const SkillMetadataSchema = z.record(z.string(), z.string());

/**
 * Strict `SKILL.md` frontmatter. Unknown top-level keys are rejected, matching the
 * reference validator's `ALLOWED_FIELDS` rule.
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(SKILL_NAME_MAX_LENGTH).regex(SKILL_NAME_PATTERN)
    .describe("Spec skill slug, equal to the folder name"),
  description: z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH)
    .describe("What the skill does and when to use it"),
  license: z.string().optional().describe("Optional license identifier"),
  compatibility: z.string().max(SKILL_COMPATIBILITY_MAX_LENGTH).optional()
    .describe("Optional free-form compatibility note (spec string form)"),
  metadata: SkillMetadataSchema.optional().describe("Flat string-to-string metadata map"),
  "allowed-tools": z.array(z.string()).optional()
    .describe("Advisory import metadata; never widens role tool permissions"),
}).strict();

export type ISkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * Knowledge-base frontmatter keys the dogfood `.copilot/skills` corpus keeps because
 * `.copilot/manifest.json` generation reads them. Runtime roots reject all of these.
 */
export const DOGFOOD_FRONTMATTER_KEYS: readonly string[] = [
  ...Object.keys(SkillFrontmatterSchema.shape),
  "agent",
  "tools",
  "scope",
  "title",
  "short_summary",
  "version",
  "topics",
  "qwen_skill",
  "capabilities",
  "links",
  "copilot_knowledge_base",
  "agent_priority",
];

/** The tools a sidecar may declare. Reuses the canonical tool-name preprocessing and union. */
export const SkillToolListSchema = z.array(
  z.preprocess(
    (value) => typeof value === "string" ? canonicalizeToolName(value) : value,
    z.union([z.nativeEnum(McpToolName), z.nativeEnum(ToolName)]),
  ),
);

/** Compatibility projection stored in the sidecar as `applies_to`. */
export const SkillAppliesToSchema = z.object({
  agents: z.array(z.string()).default(["*"]).describe('Compatible agent role ids ("*" for all)'),
  flows: z.array(z.string()).optional().describe("Flow ids this skill may be used in"),
}).strict();

/**
 * Strict `exaix.yaml` sidecar. Holds only Exaix-specific fields the Agent Skills
 * specification cannot carry (nested compatibility, lifecycle, procedure metadata).
 * Identity/name fields are rejected so the folder name remains the single source.
 */
export const SkillSidecarSchema = z.object({
  title: z.string().min(1).optional().describe("Display title (defaults to the slug)"),
  status: z.nativeEnum(SkillStatus).optional()
    .describe("Lifecycle status; absent means draft for learned/project and active otherwise"),
  triggers: SkillTriggersSchema.optional(),
  constraints: z.array(z.string()).optional(),
  output_requirements: z.array(z.string()).optional(),
  quality_criteria: z.array(SkillQualityCriterionSchema).optional(),
  critical: z.boolean().optional(),
  effort: EffortTierSchema.optional(),
  thinking: z.boolean().optional(),
  tools: SkillToolListSchema.optional(),
  applies_to: SkillAppliesToSchema.optional(),
  derived_from: z.array(z.string()).optional(),
  related_skills: z.array(z.string().regex(SKILL_NAME_PATTERN)).optional()
    .describe("Informational related skill slugs; not implicit activation"),
}).strict();

export type ISkillSidecar = z.infer<typeof SkillSidecarSchema>;

/**
 * Authorable create input. Selects only fields a person may author. Strict, so an
 * injected managed identity, path, source, status or approval field is rejected.
 */
export const SkillAuthoringSchema = z.object({
  name: z.string().min(1).max(SKILL_NAME_MAX_LENGTH).regex(SKILL_NAME_PATTERN),
  title: z.string().min(1).optional(),
  description: z.string().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH),
  instructions: z.string().min(1),
  examples: z.string().optional(),
  triggers: SkillTriggersSchema.optional(),
  constraints: z.array(z.string()).optional(),
  output_requirements: z.array(z.string()).optional(),
  quality_criteria: z.array(SkillQualityCriterionSchema).optional(),
  critical: z.boolean().optional(),
  effort: EffortTierSchema.optional(),
  thinking: z.boolean().optional(),
  tools: SkillToolListSchema.optional(),
  applies_to: SkillAppliesToSchema.optional(),
  related_skills: z.array(z.string().regex(SKILL_NAME_PATTERN)).optional(),
}).strict();

export type ISkillAuthoring = z.infer<typeof SkillAuthoringSchema>;

/** Authorable update input: the create fields minus `name`, all optional and strict. */
export const SkillAuthoringUpdateSchema = SkillAuthoringSchema.omit({ name: true }).partial().strict();
export type ISkillAuthoringUpdate = z.infer<typeof SkillAuthoringUpdateSchema>;
