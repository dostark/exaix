/**
 * @module SkillsService
 * @path packages/core/src/skills/skills.ts
 * @related-files []
 * @architectural-layer Core
 * @description Manages procedural memory (skills).
 *
 * Skills encode domain expertise, procedures, and best practices as reusable
 * instruction modules that agents apply to tasks.
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import {
  DEFAULT_SKILL_CONTEXT_CHAR_BUDGET,
  DEFAULT_SKILL_INDEX_VERSION,
  DEFAULT_SKILLS_KEYWORD_MATCH_SATURATION,
  type MemoryBankSource,
  MemoryScope,
  SkillStatus,
} from "../../mod.ts";
import { extractKeywords } from "./text_utils.ts";
import type {
  ISkill,
  ISkillIndex,
  ISkillIndexEntry,
  ISkillMatch,
  ISkillTriggers,
  SkillDefinition,
  SkillIndexSchema as _SkillIndexSchema,
  SkillUpdates,
} from "@exaix/schemas/memory_bank.ts";
import type { ISkillsService } from "../types/mod.ts";
import type { ISkillMatchRequest } from "../types/mod.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";

export interface ISkillsConfig {
  autoMatch: boolean;
  maxSkillsPerRequest: number;
  skillContextBudget: number;
  matchThreshold: number;
}

const DEFAULT_CONFIG: ISkillsConfig = {
  autoMatch: true,
  maxSkillsPerRequest: 5,
  skillContextBudget: DEFAULT_SKILL_CONTEXT_CHAR_BUDGET,
  matchThreshold: 0.3,
};

export class SkillsService implements ISkillsService {
  private skillsConfig: ISkillsConfig;
  private skillsDir: string | null = null;
  private projectSkillsDir: string | null = null;

  constructor(
    private config: { memoryDir: string; portal?: string },
    private db: IDatabaseService,
    skillsConfig?: Opt<Partial<ISkillsConfig>, Reason.OptionalInput>,
    private logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.skillsConfig = { ...DEFAULT_CONFIG, ...skillsConfig };
  }

  async initialize(): Promise<void> {
    this.skillsDir = join(this.config.memoryDir, "Skills");
    const globalDir = join(this.skillsDir, MemoryScope.GLOBAL);
    const coreDir = join(this.skillsDir, "core");
    const learnedDir = join(this.skillsDir, "learned");
    const projectDir = join(this.skillsDir, "project");

    for (const dir of [globalDir, coreDir, learnedDir, projectDir]) {
      if (!(await exists(dir))) {
        await Deno.mkdir(dir, { recursive: true });
      }
    }

    if (this.config.portal) {
      this.projectSkillsDir = join(projectDir, this.config.portal);
      if (!(await exists(this.projectSkillsDir))) {
        await Deno.mkdir(this.projectSkillsDir, { recursive: true });
      }
    }

    await this.loadIndex();
  }

  async getSkill(skillId: string): Promise<ISkill | null> {
    const skillPath = await this.findSkillPath(skillId);
    if (!skillPath) return null;

    try {
      const content = await Deno.readTextFile(skillPath);
      const parsed = JSON.parse(content);
      return parsed as ISkill;
    } catch (error) {
      console.error(`Failed to load skill ${skillId}:`, error);
      return null;
    }
  }

  async listSkills(
    filter?: Opt<{
      status?: SkillStatus;
      scope?: MemoryScope;
      source?: MemoryBankSource;
    }, Reason.QueryFilter>,
  ): Promise<ISkill[]> {
    const index = await this.loadIndex();
    let filtered = index.skills;

    if (filter?.status) {
      filtered = filtered.filter((s: ISkillIndexEntry) => s.status === filter.status);
    }
    if (filter?.scope) {
      filtered = filtered.filter((s: ISkillIndexEntry) => s.scope === filter.scope);
    }

    const skills = await Promise.all(
      filtered.map((entry: ISkillIndexEntry) => this.getSkill(entry.skill_id)),
    );

    const validSkills = skills.filter((s): s is ISkill => s !== null);

    if (filter?.source) {
      return validSkills.filter((s: ISkill) => s.source === filter.source);
    }

    return validSkills;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const skillPath = await this.findSkillPath(skillId);
    if (!skillPath) return false;

    try {
      await Deno.remove(skillPath);
      await this.rebuildIndex();
      return true;
    } catch {
      return false;
    }
  }

  async createSkill(
    skill: SkillDefinition,
  ): Promise<ISkill> {
    if (!this.skillsDir) await this.initialize();

    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();

    const newSkill: ISkill = {
      ...skill,
      id,
      created_at,
      usage_count: 0,
    };

    const fileName = `${newSkill.skill_id}.json`;
    const skillPath = newSkill.scope === MemoryScope.GLOBAL
      ? join(this.skillsDir!, MemoryScope.GLOBAL, fileName)
      : join(this.projectSkillsDir!, fileName);

    await this.writeSkillToFile(newSkill, skillPath);

    const index = await this.loadIndex();
    index.skills.push({
      skill_id: newSkill.skill_id,
      name: newSkill.name,
      version: newSkill.version,
      status: newSkill.status,
      scope: newSkill.scope,
      project: newSkill.project,
      triggers: newSkill.triggers,
      path: this.getRelativePath(skillPath),
    });
    index.updated_at = new Date().toISOString();
    await this.saveIndex(index);

    this.logger?.info(
      "skill.created",
      newSkill.skill_id,
      { id: newSkill.id, name: newSkill.name, scope: newSkill.scope },
    );

    return newSkill;
  }

  async updateSkill(
    skillId: string,
    updates: SkillUpdates,
  ): Promise<ISkill | null> {
    const skill = await this.getSkill(skillId);
    if (!skill) return null;

    const updatedSkill: ISkill = {
      ...skill,
      ...updates,
    };

    const skillPath = await this.findSkillPath(skillId);
    if (!skillPath) return null;

    await this.writeSkillToFile(updatedSkill, skillPath);

    const index = await this.loadIndex();
    const entryIdx = index.skills.findIndex((s: ISkillIndexEntry) => s.skill_id === skillId);
    if (entryIdx !== -1) {
      index.skills[entryIdx] = {
        ...index.skills[entryIdx],
        name: updatedSkill.name,
        version: updatedSkill.version,
        status: updatedSkill.status,
        triggers: updatedSkill.triggers,
      };
      index.updated_at = new Date().toISOString();
      await this.saveIndex(index);
    }

    this.logger?.info(
      "skill.updated",
      skillId,
      { updates: Object.keys(updates) },
    );

    return updatedSkill;
  }

  async activateSkill(skillId: string): Promise<boolean> {
    const updated = await this.updateSkill(skillId, { status: SkillStatus.ACTIVE });
    return updated !== null;
  }

  async deprecateSkill(skillId: string): Promise<boolean> {
    const updated = await this.updateSkill(skillId, { status: SkillStatus.DEPRECATED });
    return updated !== null;
  }

  async matchSkills(request: ISkillMatchRequest): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    if (!this.skillsDir) await this.initialize();
    if (!this.skillsConfig.autoMatch) return { matches: [], totalAvailable: 0 };

    const index = await this.loadIndex();
    const activeSkills = index.skills.filter((s: ISkillIndexEntry) => s.status === SkillStatus.ACTIVE);

    const matches: ISkillMatch[] = [];

    for (const entry of activeSkills) {
      const { confidence, matchedTriggers } = this.calculateTriggerMatch(entry.triggers, request);

      if (confidence >= this.skillsConfig.matchThreshold) {
        matches.push({
          skillId: entry.skill_id,
          confidence,
          matchedTriggers,
        });
      }
    }

    matches.sort((a, b) => b.confidence - a.confidence);

    const totalAvailable = matches.length;
    const limitedMatches = matches.slice(0, this.skillsConfig.maxSkillsPerRequest);
    const contextBudgetChars = request.contextBudgetChars;

    if (contextBudgetChars === undefined) {
      return { matches: limitedMatches, totalAvailable };
    }

    const budgetedMatches: ISkillMatch[] = [];
    let remainingBudget = contextBudgetChars;

    for (const match of limitedMatches) {
      const skill = await this.getSkill(match.skillId);
      if (!skill) {
        continue;
      }

      const skillBlockLength = this.formatSkillForPrompt(skill).length;
      if (skillBlockLength > remainingBudget) {
        break;
      }

      budgetedMatches.push(match);
      remainingBudget -= skillBlockLength;
    }

    return { matches: budgetedMatches, totalAvailable };
  }

  private calculateTriggerMatch(
    triggers: ISkillTriggers,
    request: ISkillMatchRequest,
  ): { confidence: number; matchedTriggers: Partial<ISkillTriggers> } {
    let totalScore = 0;
    let maxPossibleScore = 0;
    const matched: Partial<ISkillTriggers> = {};

    const keywordResults = this.scoreKeywordTriggers(triggers.keywords, request.keywords);
    totalScore += keywordResults.score;
    maxPossibleScore += keywordResults.max;
    if (keywordResults.matched) matched.keywords = keywordResults.matched;

    const taskTypeResults = this.scoreTaskTypeTriggers(triggers.task_types, request.taskType);
    totalScore += taskTypeResults.score;
    maxPossibleScore += taskTypeResults.max;
    if (taskTypeResults.matched) matched.task_types = taskTypeResults.matched;

    const fileResults = this.scoreFilePatternTriggers(triggers.file_patterns, request.filePaths);
    totalScore += fileResults.score;
    maxPossibleScore += fileResults.max;
    if (fileResults.matched) matched.file_patterns = fileResults.matched;

    const tagResults = this.scoreTagTriggers(triggers.tags, request.tags);
    totalScore += tagResults.score;
    maxPossibleScore += tagResults.max;
    if (tagResults.matched) matched.tags = tagResults.matched;

    if (request.requestText && triggers.keywords) {
      const requestKeywords = extractKeywords(request.requestText);
      const textMatch = this.scoreKeywordTriggers(triggers.keywords, requestKeywords);
      totalScore += textMatch.score * 0.5;
      maxPossibleScore += textMatch.max * 0.5;
    }

    const confidence = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

    return { confidence, matchedTriggers: matched };
  }

  private scoreKeywordTriggers(
    triggerKeywords: Opt<string[], Reason.OptionalInput>,
    requestKeywords: Opt<string[], Reason.OptionalInput>,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerKeywords || triggerKeywords.length === 0) return { max: 0, score: 0 };
    const max = 1.0;
    if (!requestKeywords || requestKeywords.length === 0) return { max, score: 0 };

    const matches = triggerKeywords.filter((k) => requestKeywords.some((rk) => rk.toLowerCase() === k.toLowerCase()));

    if (matches.length === 0) return { max, score: 0 };

    // Score by matched-keyword count against a saturation cap, not by dividing over the
    // trigger's total keyword count — a skill with a long trigger list (covering many
    // possible phrasings) must not be penalized for the keywords a given request doesn't use.
    const score = Math.min(matches.length / DEFAULT_SKILLS_KEYWORD_MATCH_SATURATION, 1.0) * max;
    return { max, score, matched: matches };
  }

  private scoreTaskTypeTriggers(
    triggerTaskTypes: Opt<string[], Reason.OptionalInput>,
    requestTaskType: Opt<string, Reason.OptionalInput>,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerTaskTypes || triggerTaskTypes.length === 0) return { max: 0, score: 0 };
    const max = 0.8;
    if (!requestTaskType) return { max, score: 0 };

    const matched = triggerTaskTypes.includes(requestTaskType.toLowerCase());
    return { max, score: matched ? max : 0, matched: matched ? [requestTaskType] : undefined };
  }

  private scoreFilePatternTriggers(
    triggerPatterns: Opt<string[], Reason.OptionalInput>,
    requestFilePaths: Opt<string[], Reason.OptionalInput>,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerPatterns || triggerPatterns.length === 0) return { max: 0, score: 0 };
    const max = 0.5;
    if (!requestFilePaths || requestFilePaths.length === 0) return { max, score: 0 };

    const matches = triggerPatterns.filter((p) =>
      requestFilePaths.some((f) => {
        if (p.startsWith("*.")) return f.endsWith(p.slice(1));
        return f === p;
      })
    );

    return { max, score: matches.length > 0 ? max : 0, matched: matches.length > 0 ? matches : undefined };
  }

  private scoreTagTriggers(
    triggerTags: Opt<string[], Reason.OptionalInput>,
    requestTags: Opt<string[], Reason.OptionalInput>,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerTags || triggerTags.length === 0) return { max: 0, score: 0 };
    const max = 0.3;
    if (!requestTags || requestTags.length === 0) return { max, score: 0 };

    const matches = triggerTags.filter((t) => requestTags.includes(t));
    return { max, score: matches.length > 0 ? max : 0, matched: matches.length > 0 ? matches : undefined };
  }

  async buildSkillContext(skillIds: string[]): Promise<string> {
    if (skillIds.length === 0) return "";

    const skills = await Promise.all(skillIds.map((id) => this.getSkill(id)));
    const validSkills = skills.filter((s): s is ISkill => s !== null);

    if (validSkills.length === 0) return "";

    let context = "\n### APPLICABLE SKILLS & PROCEDURES\n";
    context += "The following specialized procedures should be applied to this task:\n\n";

    let currentBudget = this.skillsConfig.skillContextBudget;

    for (const skill of validSkills) {
      const skillBlock = this.formatSkillForPrompt(skill);

      if (skillBlock.length <= currentBudget) {
        context += skillBlock + "\n";
        currentBudget -= skillBlock.length;
      } else {
        context += "*(Other compatible skills matched but excluded due to context budget)*\n";
        break;
      }
    }

    return context;
  }

  private formatSkillForPrompt(skill: ISkill): string {
    let block = `#### ${skill.name} (v${skill.version})\n`;
    block += `${skill.description}\n\n`;
    block += `**Instructions:**\n${skill.instructions}\n`;

    if (skill.constraints && skill.constraints.length > 0) {
      block += `\n**Constraints:**\n`;
      block += skill.constraints.map((c) => `- ${c}`).join("\n") + "\n";
    }

    if (skill.output_requirements && skill.output_requirements.length > 0) {
      block += `\n**Output Requirements:**\n`;
      block += skill.output_requirements.map((r) => `- ${r}`).join("\n") + "\n";
    }

    return block;
  }

  async recordSkillUsage(skillId: string): Promise<void> {
    const skillPath = await this.findSkillPath(skillId);
    if (!skillPath) return;

    try {
      const skill = await this.getSkill(skillId);
      if (skill) {
        skill.usage_count = (skill.usage_count || 0) + 1;
        await this.writeSkillToFile(skill, skillPath);
        this.logger?.info(
          "skill.used",
          skillId,
          { usage_count: skill.usage_count },
        );
      }
    } catch (error) {
      console.error(`Failed to record usage for skill ${skillId}:`, error);
    }
  }

  async deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
  ): Promise<ISkill> {
    const skill: ISkill = await this.createSkill({
      ...skillDef,
      derived_from: learningIds,
    });

    this.logger?.info(
      "skill.derived",
      skill.skill_id,
      { learning_ids: learningIds },
    );

    return skill;
  }

  async rebuildIndex(): Promise<void> {
    const index = await this.buildIndex();
    await this.saveIndex(index);
  }

  private async findSkillPath(skillId: string): Promise<string | null> {
    if (!this.skillsDir) await this.initialize();

    if (this.projectSkillsDir) {
      const projectPath = join(this.projectSkillsDir, `${skillId}.json`);
      if (await exists(projectPath)) return projectPath;
    }

    const globalPath = join(this.skillsDir!, MemoryScope.GLOBAL, `${skillId}.json`);
    if (await exists(globalPath)) return globalPath;

    return null;
  }

  private async findSkillFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        files.push(...(await this.findSkillFiles(join(dir, entry.name))));
      } else if (entry.name.endsWith(".json") && entry.name !== "index.json") {
        files.push(join(dir, entry.name));
      }
    }
    return files;
  }

  private getRelativePath(fullPath: string): string {
    return fullPath.replace(this.skillsDir! + "/", "");
  }

  private async buildIndex(): Promise<ISkillIndex> {
    const skills: ISkillIndexEntry[] = [];
    const files = await this.findSkillFiles(this.skillsDir!);

    for (const file of files) {
      try {
        const content = await Deno.readTextFile(file);
        const skill = JSON.parse(content) as ISkill;

        skills.push({
          skill_id: skill.skill_id,
          name: skill.name,
          version: skill.version,
          status: skill.status,
          scope: skill.scope,
          project: skill.project,
          triggers: skill.triggers,
          path: this.getRelativePath(file),
        });
      } catch (error) {
        console.error(`Failed to index skill file ${file}:`, error);
      }
    }

    return {
      version: DEFAULT_SKILL_INDEX_VERSION,
      updated_at: new Date().toISOString(),
      skills,
    };
  }

  private async loadIndex(): Promise<ISkillIndex> {
    if (!this.skillsDir) await this.initialize();
    const indexPath = join(this.skillsDir!, "index.json");

    try {
      const content = await Deno.readTextFile(indexPath);
      return JSON.parse(content) as ISkillIndex;
    } catch {
      const index = await this.buildIndex();
      await this.saveIndex(index);
      return index;
    }
  }

  private async saveIndex(index: ISkillIndex): Promise<void> {
    if (!this.skillsDir) return;
    const indexPath = join(this.skillsDir!, "index.json");
    await Deno.writeTextFile(indexPath, JSON.stringify(index, null, 2));
  }

  private async writeSkillToFile(skill: ISkill, path: string): Promise<void> {
    await Deno.writeTextFile(path, JSON.stringify(skill, null, 2));
  }
}
