/**
 * @module SkillsAdapter
 * @path src/services/adapters/skills_adapter.ts
 * @description Adapter for SkillsService that satisfies the ISkillsService interface.
 * @architectural-layer Services/Adapters
 * * @related-files [src/shared/interfaces/i_skills_service.ts, src/services/skills.ts] */

import type { ISkillsService } from "../../shared/interfaces/i_skills_service.ts";
import type { SkillsService } from "../skills/skills.ts";
import type { ISkill, ISkillMatch, SkillDefinition } from "@exaix/schemas/memory_bank.ts";
import type { ISkillMatchRequest } from "../../shared/types/skill.ts";
import { MemoryBankSource, SkillStatus } from "../../shared/enums.ts";

export class SkillsAdapter implements ISkillsService {
  constructor(private inner: SkillsService) {}

  async initialize(): Promise<void> {
    return await this.inner.initialize();
  }

  async matchSkills(request: ISkillMatchRequest): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    return await this.inner.matchSkills(request);
  }

  async buildSkillContext(skillIds: string[]): Promise<string> {
    return await this.inner.buildSkillContext(skillIds);
  }

  async recordSkillUsage(skillId: string): Promise<void> {
    return await this.inner.recordSkillUsage(skillId);
  }

  async deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
  ): Promise<ISkill> {
    return await this.inner.deriveSkillFromLearnings(learningIds, skillDef);
  }

  async createSkill(skillDef: SkillDefinition): Promise<ISkill> {
    return await this.inner.createSkill(skillDef);
  }

  async rebuildIndex(): Promise<void> {
    return await this.inner.rebuildIndex();
  }

  async listSkills(filter?: { source?: MemoryBankSource; status?: SkillStatus }): Promise<ISkill[]> {
    const normalized: {
      status?: SkillStatus;
      source?: MemoryBankSource;
    } = {};

    if (filter?.status && Object.values(SkillStatus).includes(filter.status as SkillStatus)) {
      normalized.status = filter.status as SkillStatus;
    }

    if (filter?.source && Object.values(MemoryBankSource).includes(filter.source as MemoryBankSource)) {
      normalized.source = filter.source as MemoryBankSource;
    }

    return await this.inner.listSkills(normalized);
  }

  async getSkill(skillId: string): Promise<ISkill | null> {
    return await this.inner.getSkill(skillId);
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    return await this.inner.deleteSkill(skillId);
  }
}
