/**
 * @module StubSkillsService
 * @path packages/testing/src/helpers/stub_skills_service.ts
 * @description An `ISkillsService` test double whose every method is an inert default. Tests
 *   extend it and override only the methods they assert on, so a contract change touches one place.
 * @architectural-layer Testing
 * @dependencies [@exaix/core, @exaix/core/skills, @exaix/schemas]
 * @related-files [packages/core/src/types/i_skills_service.ts, packages/testing/src/helpers/skill_catalog.ts]
 */

import type { ISkillMatchRequest, ISkillsService } from "@exaix/core/types";
import type { ISkillDiagnostic, ISkillOperationContext } from "@exaix/core/skills";
import type { ISkill, ISkillMatch, SkillDefinition, SkillUpdates } from "@exaix/schemas/memory_bank.ts";
import { SkillStatus } from "@exaix/core";
import { runtimeSkillFixture } from "./skill_catalog.ts";

export class StubSkillsService implements ISkillsService {
  initialize(): Promise<void> {
    return Promise.resolve();
  }

  matchSkills(_request: ISkillMatchRequest): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    return Promise.resolve({ matches: [], totalAvailable: 0 });
  }

  buildSkillContext(_skillIds: string[]): Promise<string> {
    return Promise.resolve("");
  }

  getSkill(_skillId: string): Promise<ISkill | null> {
    return Promise.resolve(null);
  }

  listSkills(): Promise<ISkill[]> {
    return Promise.resolve([]);
  }

  listDiagnostics(): Promise<ISkillDiagnostic[]> {
    return Promise.resolve([]);
  }

  createSkill(skillDef: SkillDefinition, _ctx: ISkillOperationContext): Promise<ISkill> {
    return Promise.resolve(
      runtimeSkillFixture({
        skill_id: skillDef.name,
        title: skillDef.title ?? skillDef.name,
        description: skillDef.description,
        instructions: skillDef.instructions,
        status: SkillStatus.DRAFT,
      }),
    );
  }

  deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
    ctx: ISkillOperationContext,
  ): Promise<ISkill> {
    return this.createSkill(skillDef, ctx).then((skill) => ({ ...skill, derived_from: learningIds }));
  }

  updateSkill(_skillId: string, _updates: SkillUpdates, _ctx: ISkillOperationContext): Promise<ISkill | null> {
    return Promise.resolve(null);
  }

  approveSkill(skillId: string, _expectedRevisionId: string, _ctx: ISkillOperationContext): Promise<ISkill> {
    return Promise.resolve(runtimeSkillFixture({ skill_id: skillId }));
  }

  activateSkill(skillId: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return this.approveSkill(skillId, expectedRevisionId, ctx);
  }

  deprecateSkill(skillId: string, _ctx: ISkillOperationContext): Promise<ISkill> {
    return Promise.resolve(runtimeSkillFixture({ skill_id: skillId, status: SkillStatus.DEPRECATED }));
  }

  deleteSkill(_skillId: string, _ctx: ISkillOperationContext): Promise<boolean> {
    return Promise.resolve(false);
  }
}
