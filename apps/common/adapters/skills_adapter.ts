/**
 * @module SkillsAdapter
 * @path apps/common/adapters/skills_adapter.ts
 * @description Adapter for SkillsService that satisfies the ISkillsService interface.
 * @architectural-layer Services/Adapters
 * @ungrounded
 * @related-files ["packages/core/src/types/i_skills_service.ts", "packages/core/src/skills/skills.ts"] */

import type { ISkillsService } from "@exaix/core/types";
import type {
  ISkillDiagnostic,
  ISkillOperationContext,
  ISkillSubmission,
  ISkillUsageRecord,
  ISkillUsageSummary,
  SkillsService,
} from "@exaix/core/skills";
import type { ISkill, ISkillMatch, SkillDefinition, SkillUpdates } from "@exaix/schemas/memory_bank.ts";
import type { ISkillMatchRequest } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import { MemoryBankSource, type MemoryScope, SkillStatus } from "@exaix/core";

export class SkillsAdapter implements ISkillsService {
  constructor(private inner: SkillsService) {}

  async initialize(): Promise<void> {
    return await this.inner.initialize();
  }

  async recordSubmission(submission: ISkillSubmission, ctx: ISkillOperationContext): Promise<void> {
    return await this.inner.recordSubmission(submission, ctx);
  }

  async getUsageSummary(
    skillId: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillUsageSummary> {
    return await this.inner.getUsageSummary(skillId, ctx);
  }

  async usageByTrace(
    traceId: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillUsageRecord[]> {
    return await this.inner.usageByTrace(traceId, ctx);
  }

  forContext(ctx: ISkillOperationContext): ISkillsService {
    return this.inner.forContext(ctx);
  }

  async ensureRevisions(
    revisionIds: readonly string[],
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<void> {
    return await this.inner.ensureRevisions(revisionIds, ctx);
  }

  async matchSkills(
    request: ISkillMatchRequest,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    return await this.inner.matchSkills(request, ctx);
  }

  async buildSkillContext(
    skillIds: string[],
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<string> {
    return await this.inner.buildSkillContext(skillIds, ctx);
  }

  async deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
    ctx: ISkillOperationContext,
  ): Promise<ISkill> {
    return await this.inner.deriveSkillFromLearnings(learningIds, skillDef, ctx);
  }

  async createSkill(skillDef: SkillDefinition, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.inner.createSkill(skillDef, ctx);
  }

  async updateSkill(skillId: string, updates: SkillUpdates, ctx: ISkillOperationContext): Promise<ISkill | null> {
    return await this.inner.updateSkill(skillId, updates, ctx);
  }

  async approveSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.inner.approveSkill(skillId, expectedRevisionId, ctx);
  }

  async activateSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.inner.activateSkill(skillId, expectedRevisionId, ctx);
  }

  async deprecateSkill(skillId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.inner.deprecateSkill(skillId, ctx);
  }

  async listSkills(
    filter?: Opt<{ source?: MemoryBankSource; status?: SkillStatus; scope?: MemoryScope }, Reason.QueryFilter>,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkill[]> {
    const normalized: {
      status?: SkillStatus;
      source?: MemoryBankSource;
      scope?: MemoryScope;
    } = {};

    if (filter?.status && Object.values(SkillStatus).includes(filter.status as SkillStatus)) {
      normalized.status = filter.status as SkillStatus;
    }

    if (filter?.source && Object.values(MemoryBankSource).includes(filter.source as MemoryBankSource)) {
      normalized.source = filter.source as MemoryBankSource;
    }

    if (filter?.scope) normalized.scope = filter.scope;

    return await this.inner.listSkills(normalized, ctx);
  }

  async listDiagnostics(ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkillDiagnostic[]> {
    return await this.inner.listDiagnostics(ctx);
  }

  async getSkill(skillId: string, ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkill | null> {
    return await this.inner.getSkill(skillId, ctx);
  }

  async deleteSkill(skillId: string, ctx: ISkillOperationContext): Promise<boolean> {
    return await this.inner.deleteSkill(skillId, ctx);
  }
}
