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
export { createSkillOperationContext, SKILL_CONFIG_GENERATION_STATIC } from "./skill_context.ts";
export { SkillFolderLoader } from "./skill_folder_loader.ts";
export { SkillFolderPublisher } from "./skill_folder_publisher.ts";
export { buildSkillPin, orderSkillPins, skillToContextEntry } from "./skill_pins.ts";
export { policySkillSubmission } from "./skill_submission.ts";
export { SkillUsageStore } from "./skill_usage_store.ts";
export { SkillRevisionStore } from "./skill_revision_store.ts";
export {
  canonicalizeSkillText,
  computeRevisionId,
  computeSkillContentSha256,
  parseSkillSnapshot,
} from "./skill_snapshot.ts";
export {
  type ILoadedSkill,
  type IPinnedSkill,
  type IResolvedSkillRoot,
  type ISkillDiagnostic,
  type ISkillFolderLimits,
  type ISkillOperationContext,
  type ISkillPin,
  type ISkillRevisionRecord,
  type ISkillRevisionSnapshot,
  type ISkillRootContext,
  type ISkillSubmission,
  type ISkillSubmissionItem,
  type ISkillUsageRecord,
  type ISkillUsageSummary,
  SkillAuditUnavailableError,
  SkillMutationError,
  SkillUnavailableError,
} from "./skill_types.ts";
