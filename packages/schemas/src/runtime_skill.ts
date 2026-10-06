/**
 * @module RuntimeSkillSchema
 * @path packages/schemas/src/runtime_skill.ts
 * @description The runtime view of a loaded skill folder: the projection of
 *   `SKILL.md` frontmatter, the `exaix.yaml` sidecar and the parsed body, plus its
 *   content-addressed revision identity and per-resolution provenance. `name` and
 *   `skill_id` are the validated slug; `title` is the display title; `id` is the
 *   revision UUID.
 * @architectural-layer Schemas
 * @dependencies [zod, @exaix/core, ./memory_bank.ts, ./skill_folder.ts, ./model_intent.ts]
 * @related-files [packages/core/src/skills/skill_snapshot.ts]
 */

import { z } from "zod";
import { EffortTierSchema } from "./model_intent.ts";
import { MemoryBankSource, MemoryScope, SkillRootKind, SkillStatus } from "@exaix/core";
import { SkillCompatibilitySchema, SkillQualityCriterionSchema, SkillTriggersSchema } from "./memory_bank.ts";
import { SKILL_NAME_PATTERN, SkillToolListSchema } from "./skill_folder.ts";

/** A validated `references/*.md` file bundled with a skill. `linked` marks files the body
 *  links to. Unlinked files are hashed and snapshotted but not rendered. */
export const SkillReferenceSchema = z.object({
  path: z.string().regex(/^references\/[a-z0-9]+(-[a-z0-9]+)*\.md$/),
  content: z.string(),
  linked: z.boolean(),
});
export type ISkillReference = z.infer<typeof SkillReferenceSchema>;

/** How the effective trigger set was produced. */
export const SkillTriggersSourceSchema = z.enum(["authored", "description"]);
export type ISkillTriggersSource = z.infer<typeof SkillTriggersSourceSchema>;

/**
 * The runtime skill view. Identity (`id`, `content_sha256`, `path`, `root_kind`) is
 * derived from content. There is no authored UUID, counter or semantic version.
 * The revision is the version policy.
 */
export const RuntimeSkillSchema = z.object({
  id: z.string().uuid().describe("Content-addressed revision UUIDv5"),
  skill_id: z.string().regex(SKILL_NAME_PATTERN).describe("Validated slug (compatibility alias for name)"),
  name: z.string().regex(SKILL_NAME_PATTERN).describe("Validated slug, equal to the folder name"),
  title: z.string().min(1).describe("Display title"),
  description: z.string().describe("What the skill does and when to use it"),

  status: z.nativeEnum(SkillStatus),
  source: z.nativeEnum(MemoryBankSource),
  scope: z.nativeEnum(MemoryScope),
  project: z.string().optional(),

  root_kind: z.nativeEnum(SkillRootKind),
  path: z.string().describe("Configured-relative safe path of the skill folder"),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),

  triggers: SkillTriggersSchema,
  triggers_source: SkillTriggersSourceSchema,

  instructions: z.string(),
  examples: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  output_requirements: z.array(z.string()).optional(),
  quality_criteria: z.array(SkillQualityCriterionSchema).optional(),
  critical: z.boolean().optional(),
  effort: EffortTierSchema.optional(),
  thinking: z.boolean().optional(),
  tools: SkillToolListSchema.optional(),
  compatible_with: SkillCompatibilitySchema.optional(),
  derived_from: z.array(z.string()).optional(),
  related_skills: z.array(z.string()).optional(),
  references: z.array(SkillReferenceSchema).default([]),
});

export type IRuntimeSkill = z.infer<typeof RuntimeSkillSchema>;
