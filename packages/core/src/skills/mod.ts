/**
 * @module Skills
 * @path packages/core/src/skills/mod.ts
 * @related-files []
 * @architectural-layer Core
 * @description Skills — merged into @exaix/core as a sub-domain.
 */

export { CriteriaGenerator } from "./criteria_generator.ts";
export { EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR, SkillsService } from "./skills.ts";
export type { ISkillsConfig } from "./skills.ts";
export {
  canonicalizeSkillText,
  computeRevisionId,
  computeSkillContentSha256,
  findLinkedReferencePaths,
  parseSkillSnapshot,
  SKILL_REVISION_NAMESPACE,
} from "./skill_snapshot.ts";
export {
  type ILoadedSkill,
  type IResolvedSkillRoot,
  type ISkillDiagnostic,
  type ISkillOperationContext,
  type ISkillPin,
  type ISkillRevisionSnapshot,
  type ISkillRootContext,
  type ISkillStoreDeps,
  SkillUnavailableError,
} from "./skill_types.ts";
