/**
 * @module SkillSubmission
 * @path packages/core/src/skills/skill_submission.ts
 * @description Builds the submission record for a skill that a service injects verbatim as policy
 *   text at its own provider call, as the memory extraction and reflection services do. The skill
 *   was named explicitly, so its source is pinned, and its body is rendered in full.
 * @architectural-layer Core
 * @dependencies [@exaix/schemas, ../types/enums.ts, ./skill_types.ts]
 * @related-files [packages/memory/src/extraction/llm_learning_extractor.ts, packages/memory/src/reflection/memory_reflection_service.ts]
 */

import type { ISkill } from "@exaix/schemas/memory_bank.ts";
import { SkillMatchSource, SkillRenderOutcome, SkillSubmissionKind } from "../types/enums.ts";
import type { ISkillSubmission } from "./skill_types.ts";

/** A single-skill provider submission for one policy call. */
export function policySkillSubmission(skill: ISkill): ISkillSubmission {
  return {
    callId: crypto.randomUUID(),
    submissionKind: SkillSubmissionKind.PROVIDER,
    round: 1,
    attempt: 1,
    items: [{
      skillName: skill.skill_id,
      revisionId: skill.id,
      matchSource: SkillMatchSource.PINNED,
      renderMode: SkillRenderOutcome.FULL,
      rootKind: skill.root_kind,
      sourcePath: skill.path,
    }],
  };
}
