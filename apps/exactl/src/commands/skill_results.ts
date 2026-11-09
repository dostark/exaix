/**
 * @module SkillCommandResults
 * @path apps/exactl/src/commands/skill_results.ts
 * @description The data the skill commands return. The skill builder renders it.
 * @architectural-layer CLI
 * @dependencies [@exaix/core/skills, @exaix/schemas]
 * @related-files [apps/exactl/src/commands/memory_commands.ts, apps/exactl/src/command_builders/skill_commands.ts]
 */

import type { ISkillDiagnostic, ISkillUsageSummary } from "@exaix/core/skills";
import type { ISkill } from "@exaix/schemas/memory_bank.ts";

export interface ISkillListResult {
  skills: ISkill[];
  diagnostics?: ISkillDiagnostic[];
}

export interface ISkillShowResult {
  skill: ISkill;
  usage: ISkillUsageSummary;
}

/** One stored revision with its content, origin and use counts. */
export interface ISkillRevisionDetail {
  revisionId: string;
  skillName: string;
  contentSha256: string;
  firstSeenAt: string;
  skillMd: string;
  exaixYaml: string | null;
  references: readonly { path: string; content: string }[];
  origin: { rootKind: string; sourcePath: string } | null;
  summary: { useCount: number; lastUsedAt: string | null };
}

export interface ISkillApproveResult {
  name: string;
  reviewedRevisionId: string;
  activeRevisionId: string;
  status: string;
}

export interface ISkillDeprecateResult {
  name: string;
  revisionId: string;
  status: string;
}

export interface ISkillValidateResult {
  valid: boolean;
  diagnostics: ISkillDiagnostic[];
}
