/**
 * @module SkillScopedView
 * @path packages/core/src/skills/skill_scoped_view.ts
 * @description An `ISkillsService` view bound to one immutable operation context. Reads default to
 *   the bound context and an explicit context wins. Mutations always take their own context. The
 *   view holds no state of its own, so two views over one service never see each other's portal.
 * @architectural-layer Core
 * @dependencies [../types/i_skills_service.ts, ./skill_types.ts]
 * @related-files [packages/core/src/skills/skills.ts]
 */

import type { MemoryBankSource, MemoryScope, SkillStatus } from "../types/enums.ts";
import type { ISkillsService } from "../types/i_skills_service.ts";
import type { ISkillMatchRequest } from "../types/mod.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";
import type { ISkill, ISkillMatch, SkillDefinition, SkillUpdates } from "@exaix/schemas/memory_bank.ts";
import type {
  ISkillDiagnostic,
  ISkillOperationContext,
  ISkillSubmission,
  ISkillUsageRecord,
  ISkillUsageSummary,
} from "./skill_types.ts";

export class ScopedSkillsService implements ISkillsService {
  constructor(private readonly inner: ISkillsService, private readonly bound: ISkillOperationContext) {}

  forContext(ctx: ISkillOperationContext): ISkillsService {
    return this.inner.forContext(ctx);
  }

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  matchSkills(
    request: ISkillMatchRequest,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    return this.inner.matchSkills(request, ctx ?? this.bound);
  }

  buildSkillContext(skillIds: string[], ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<string> {
    return this.inner.buildSkillContext(skillIds, ctx ?? this.bound);
  }

  getSkill(skillId: string, ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkill | null> {
    return this.inner.getSkill(skillId, ctx ?? this.bound);
  }

  listSkills(
    filter?: Opt<{ source?: MemoryBankSource; status?: SkillStatus; scope?: MemoryScope }, Reason.QueryFilter>,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkill[]> {
    return this.inner.listSkills(filter, ctx ?? this.bound);
  }

  listDiagnostics(ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkillDiagnostic[]> {
    return this.inner.listDiagnostics(ctx ?? this.bound);
  }

  ensureRevisions(
    revisionIds: readonly string[],
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<void> {
    return this.inner.ensureRevisions(revisionIds, ctx ?? this.bound);
  }

  recordSubmission(submission: ISkillSubmission, ctx: ISkillOperationContext): Promise<void> {
    return this.inner.recordSubmission(submission, ctx);
  }

  getUsageSummary(
    skillId: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillUsageSummary> {
    return this.inner.getUsageSummary(skillId, ctx ?? this.bound);
  }

  usageByTrace(
    traceId: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillUsageRecord[]> {
    return this.inner.usageByTrace(traceId, ctx ?? this.bound);
  }

  createSkill(skillDef: SkillDefinition, ctx: ISkillOperationContext): Promise<ISkill> {
    return this.inner.createSkill(skillDef, ctx);
  }

  deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
    ctx: ISkillOperationContext,
  ): Promise<ISkill> {
    return this.inner.deriveSkillFromLearnings(learningIds, skillDef, ctx);
  }

  updateSkill(skillId: string, updates: SkillUpdates, ctx: ISkillOperationContext): Promise<ISkill | null> {
    return this.inner.updateSkill(skillId, updates, ctx);
  }

  approveSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return this.inner.approveSkill(skillId, expectedRevisionId, ctx);
  }

  activateSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return this.inner.activateSkill(skillId, expectedRevisionId, ctx);
  }

  deprecateSkill(skillId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return this.inner.deprecateSkill(skillId, ctx);
  }

  deleteSkill(skillId: string, ctx: ISkillOperationContext): Promise<boolean> {
    return this.inner.deleteSkill(skillId, ctx);
  }
}
