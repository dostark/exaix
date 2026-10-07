/**
 * @module SkillPinSchema
 * @path packages/schemas/src/skill_pin.ts
 * @description Strict schema for the durable skill pins a plan carries. A pin names one
 *   immutable skill revision with its provenance and selection metadata. A vector holds each
 *   skill name at most once. Execution replays the pinned revisions instead of live files.
 * @architectural-layer Schemas
 * @dependencies [zod, @exaix/core, ./skill_folder.ts]
 * @related-files [packages/core/src/skills/skill_types.ts, packages/schemas/src/plan_schema.ts]
 */

import { z } from "zod";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind } from "@exaix/core";
import { SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "./skill_folder.ts";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const PIN_PATH_MAX_LENGTH = 512;
const PIN_TASK_TYPE_MAX_LENGTH = 64;
const PIN_PORTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const SkillPinSchema = z.object({
  name: z.string().min(1).max(SKILL_NAME_MAX_LENGTH).regex(SKILL_NAME_PATTERN),
  revision_id: z.string().uuid(),
  content_sha256: z.string().regex(SHA256_HEX_PATTERN),
  root_kind: z.nativeEnum(SkillRootKind),
  source_path: z.string().min(1).max(PIN_PATH_MAX_LENGTH),
  portal: z.string().regex(PIN_PORTAL_PATTERN).nullable(),
  match_source: z.nativeEnum(SkillMatchSource),
  confidence: z.number().min(0).max(1),
  matched_task_types: z.array(z.string().min(1).max(PIN_TASK_TYPE_MAX_LENGTH)),
  required: z.boolean(),
  render_mode: z.nativeEnum(SkillRenderOutcome),
  content_included: z.boolean(),
}).strict();

export type ISkillPinRecord = z.infer<typeof SkillPinSchema>;

/** An ordered pin list with unique skill names. */
export const SkillPinVectorSchema = z.array(SkillPinSchema).superRefine((pins, ctx) => {
  const seen = new Set<string>();
  pins.forEach((entry, index) => {
    if (seen.has(entry.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "name"],
        message: `duplicate skill pin "${entry.name}"`,
      });
    }
    seen.add(entry.name);
  });
});
