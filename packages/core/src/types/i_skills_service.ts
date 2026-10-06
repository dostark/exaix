/**
 * @module IskillsService
 * @path packages/core/src/types/i_skills_service.ts
 * @description Contract of the skills service: folder-backed reads and matching, plus the
 *   guarded draft lifecycle. Reads take an optional operation context and are global-only
 *   without a portal. Every mutation requires a context.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";
import type { ISkill, ISkillMatch, SkillDefinition, SkillUpdates } from "@exaix/schemas";
import type { ISkillDiagnostic, ISkillOperationContext } from "../skills/skill_types.ts";
import type { Opt, Reason } from "./optional_marker.ts";

import type { ISkillMatchRequest } from "@exaix/core/types";

export interface ISkillsService {
  /**
   * Initialize skills service: create writable roots and recover interrupted publications.
   */
  initialize(): Promise<void>;

  /**
   * Match skills based on request context.
   */
  matchSkills(
    request: ISkillMatchRequest,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }>;

  /**
   * Build combined skill context for prompt injection.
   */
  buildSkillContext(skillIds: string[], ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<string>;

  /**
   * Get one active skill by name.
   */
  getSkill(skillId: string, ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkill | null>;

  /**
   * List valid skills of any status, optionally filtered.
   */
  listSkills(
    filter?: Opt<{ source?: MemoryBankSource; status?: SkillStatus; scope?: MemoryScope }, Reason.QueryFilter>,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkill[]>;

  /**
   * Invalid, inactive, masked and missing-root outcomes of the current catalog.
   */
  listDiagnostics(ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkillDiagnostic[]>;

  /**
   * Create a new skill as a draft folder.
   */
  createSkill(skillDef: SkillDefinition, ctx: ISkillOperationContext): Promise<ISkill>;

  /**
   * Derive a draft skill from one or more learning entries.
   */
  deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
    ctx: ISkillOperationContext,
  ): Promise<ISkill>;

  /**
   * Edit a skill. Any content or procedure change returns it to draft.
   */
  updateSkill(skillId: string, updates: SkillUpdates, ctx: ISkillOperationContext): Promise<ISkill | null>;

  /**
   * Activate a reviewed draft. Only the reviewed revision may be approved.
   */
  approveSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill>;

  /**
   * Guarded alias of approveSkill.
   */
  activateSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill>;

  /**
   * Deprecate a skill. Repeating the call is idempotent.
   */
  deprecateSkill(skillId: string, ctx: ISkillOperationContext): Promise<ISkill>;

  /**
   * Delete a skill folder from a writable root.
   */
  deleteSkill(skillId: string, ctx: ISkillOperationContext): Promise<boolean>;
}
