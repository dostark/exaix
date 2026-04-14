/**
 * @module SkillsService
 * @path src/services/skills/skills.ts
 * @description Manages procedural memory (skills).
 *
 * Skills encode domain expertise, procedures, and best practices as reusable
 * instruction modules that agents apply to tasks.
 * @architectural-layer Services
 * * @related-files [src/schemas/memory_bank.ts, src/services/agent_runner.ts]
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import type { IDatabaseService } from "../core/db.ts";
import { ActivityActor, type MemoryBankSource, MemoryScope, SkillStatus } from "../../shared/enums.ts";
import { extractKeywords } from "../../helpers/text.ts";
import { DEFAULT_SKILL_CONTEXT_CHAR_BUDGET, DEFAULT_SKILL_INDEX_VERSION } from "../../shared/constants.ts";
import {
  type ISkill,
  type ISkillIndex,
  type ISkillIndexEntry,
  type ISkillMatch,
  type ISkillTriggers,
  type SkillDefinition,
  type SkillIndexSchema as _SkillIndexSchema,
  SkillSchema,
  type SkillUpdates,
} from "../../shared/schemas/memory_bank.ts";
import { type JSONObject, type JSONValue, toSafeJson } from "../../shared/types/json.ts";
import type { ISkillsService } from "../../shared/interfaces/i_skills_service.ts";
import type { ISkillMatchRequest } from "../../shared/types/skill.ts";

/**
 * Skills Service Configuration
 */
export interface ISkillsConfig {
  /** Enable automatic skill matching */
  autoMatch: boolean;
  /** Maximum number of skills to inject into a single request */
  maxSkillsPerRequest: number;
  /** Maximum character budget for skill context */
  skillContextBudget: number;
  /** Minimum confidence score for skill matching (0-1) */
  matchThreshold: number;
}

const DEFAULT_CONFIG: ISkillsConfig = {
  autoMatch: true,
  maxSkillsPerRequest: 5,
  skillContextBudget: DEFAULT_SKILL_CONTEXT_CHAR_BUDGET,
  matchThreshold: 0.3,
};

/**
 * Skills Service
 *
 * Provides skill management and matching capabilities:
 * - CRUD operations for skills
 * - Trigger-based skill matching
 * - Skill context building for prompt injection
 * - Learning-to-skill derivation
 */
export class SkillsService implements ISkillsService {
  private skillsConfig: ISkillsConfig;
  private skillsDir: string | null = null;
  private projectSkillsDir: string | null = null;

  constructor(
    private config: { memoryDir: string; portal?: string },
    private db: IDatabaseService,
    skillsConfig?: Partial<ISkillsConfig>,
  ) {
    this.skillsConfig = { ...DEFAULT_CONFIG, ...skillsConfig };
  }

  // Initialize skills directory structure
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

    // Ensure index exists
    await this.loadIndex();
  }

  // Get a skill by ID
  async getSkill(skillId: string): Promise<ISkill | null> {
    const skillPath = await this.findSkillPath(skillId);
    if (!skillPath) return null;

    try {
      const content = await Deno.readTextFile(skillPath);
      const parsed = JSON.parse(content);
      return SkillSchema.parse(parsed) as ISkill;
    } catch (error) {
      console.error(`Failed to load skill ${skillId}:`, error);
      return null;
    }
  }

  // List all skills with optional filtering
  async listSkills(filter?: {
    status?: SkillStatus;
    scope?: MemoryScope;
    source?: MemoryBankSource;
  }): Promise<ISkill[]> {
    const index = await this.loadIndex();
    let filtered = index.skills;

    if (filter?.status) {
      filtered = filtered.filter((s: ISkillIndexEntry) => s.status === filter.status);
    }
    if (filter?.scope) {
      filtered = filtered.filter((s: ISkillIndexEntry) => s.scope === filter.scope);
    }

    // For source, we need to load full skills (index doesn't have source)
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

  // Create a new skill
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

    // Determine path
    const fileName = `${newSkill.skill_id}.json`;
    const skillPath = newSkill.scope === MemoryScope.GLOBAL
      ? join(this.skillsDir!, MemoryScope.GLOBAL, fileName)
      : join(this.projectSkillsDir!, fileName);

    await this.writeSkillToFile(newSkill, skillPath);

    // Update index
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

    this.logActivity({
      event_type: "skill.created",
      target: newSkill.skill_id,
      metadata: { id: newSkill.id, name: newSkill.name, scope: newSkill.scope },
    });

    return newSkill;
  }

  // Update an existing skill
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

    // Update index
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

    this.logActivity({
      event_type: "skill.updated",
      target: skillId,
      metadata: { updates: Object.keys(updates) },
    });

    return updatedSkill;
  }

  // Activate a draft skill
  async activateSkill(skillId: string): Promise<boolean> {
    const updated = await this.updateSkill(skillId, { status: SkillStatus.ACTIVE });
    return updated !== null;
  }

  // Deprecate an active skill
  async deprecateSkill(skillId: string): Promise<boolean> {
    const updated = await this.updateSkill(skillId, { status: SkillStatus.DEPRECATED });
    return updated !== null;
  }

  /**
   * Match skills based on request context
   */
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

    // Sort by confidence
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

  // Calculate trigger match score
  private calculateTriggerMatch(
    triggers: ISkillTriggers,
    request: ISkillMatchRequest,
  ): { confidence: number; matchedTriggers: Partial<ISkillTriggers> } {
    let totalScore = 0;
    let maxPossibleScore = 0;
    const matched: Partial<ISkillTriggers> = {};

    // 1. Keyword match (highest weight)
    const keywordResults = this.scoreKeywordTriggers(triggers.keywords, request.keywords);
    totalScore += keywordResults.score;
    maxPossibleScore += keywordResults.max;
    if (keywordResults.matched) matched.keywords = keywordResults.matched;

    // 2. Task type match
    const taskTypeResults = this.scoreTaskTypeTriggers(triggers.task_types, request.taskType);
    totalScore += taskTypeResults.score;
    maxPossibleScore += taskTypeResults.max;
    if (taskTypeResults.matched) matched.task_types = taskTypeResults.matched;

    // 3. File pattern match
    const fileResults = this.scoreFilePatternTriggers(triggers.file_patterns, request.filePaths);
    totalScore += fileResults.score;
    maxPossibleScore += fileResults.max;
    if (fileResults.matched) matched.file_patterns = fileResults.matched;

    // 4. Tag match
    const tagResults = this.scoreTagTriggers(triggers.tags, request.tags);
    totalScore += tagResults.score;
    maxPossibleScore += tagResults.max;
    if (tagResults.matched) matched.tags = tagResults.matched;

    // 5. Semantic/Heuristic match (from raw request text)
    if (request.requestText && triggers.keywords) {
      const requestKeywords = extractKeywords(request.requestText);
      const textMatch = this.scoreKeywordTriggers(triggers.keywords, requestKeywords);
      // Half weight for derived keywords
      totalScore += textMatch.score * 0.5;
      maxPossibleScore += textMatch.max * 0.5;
      // We don't add to matched.keywords as they are derived
    }

    const confidence = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

    return { confidence, matchedTriggers: matched };
  }

  private scoreKeywordTriggers(
    triggerKeywords: string[] | undefined,
    requestKeywords: string[] | undefined,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerKeywords || triggerKeywords.length === 0) return { max: 0, score: 0 };
    const max = 1.0;
    if (!requestKeywords || requestKeywords.length === 0) return { max, score: 0 };

    const matches = triggerKeywords.filter((k) => requestKeywords.some((rk) => rk.toLowerCase() === k.toLowerCase()));

    if (matches.length === 0) return { max, score: 0 };

    // Progressive score based on how many keywords matched
    const score = (matches.length / triggerKeywords.length) * 1.0;
    return { max, score, matched: matches };
  }

  private scoreTaskTypeTriggers(
    triggerTaskTypes: string[] | undefined,
    requestTaskType: string | undefined,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerTaskTypes || triggerTaskTypes.length === 0) return { max: 0, score: 0 };
    const max = 0.8;
    if (!requestTaskType) return { max, score: 0 };

    const matched = triggerTaskTypes.includes(requestTaskType.toLowerCase());
    return { max, score: matched ? max : 0, matched: matched ? [requestTaskType] : undefined };
  }

  private scoreFilePatternTriggers(
    triggerPatterns: string[] | undefined,
    requestFilePaths: string[] | undefined,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerPatterns || triggerPatterns.length === 0) return { max: 0, score: 0 };
    const max = 0.5;
    if (!requestFilePaths || requestFilePaths.length === 0) return { max, score: 0 };

    // For now, simple suffix or exact match (no full glob lib for brevity)
    const matches = triggerPatterns.filter((p) =>
      requestFilePaths.some((f) => {
        if (p.startsWith("*.")) return f.endsWith(p.slice(1));
        return f === p;
      })
    );

    return { max, score: matches.length > 0 ? max : 0, matched: matches.length > 0 ? matches : undefined };
  }

  private scoreTagTriggers(
    triggerTags: string[] | undefined,
    requestTags: string[] | undefined,
  ): { max: number; score: number; matched?: string[] } {
    if (!triggerTags || triggerTags.length === 0) return { max: 0, score: 0 };
    const max = 0.3;
    if (!requestTags || requestTags.length === 0) return { max, score: 0 };

    const matches = triggerTags.filter((t) => requestTags.includes(t));
    return { max, score: matches.length > 0 ? max : 0, matched: matches.length > 0 ? matches : undefined };
  }

  /**
   * Build combined skill context for prompt injection
   */
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
        // Budget exceeded
        context += `*(Other compatible skills matched but excluded due to context budget)*\n`;
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

  /**
   * Record that a skill was successfully used
   */
  async recordSkillUsage(skillId: string): Promise<void> {
    const skillPath = await this.findSkillPath(skillId);
    if (!skillPath) return;

    try {
      const skill = await this.getSkill(skillId);
      if (skill) {
        skill.usage_count = (skill.usage_count || 0) + 1;
        await this.writeSkillToFile(skill, skillPath);
        this.logActivity({
          event_type: "skill.used",
          target: skillId,
          metadata: { usage_count: skill.usage_count },
        });
      }
    } catch (error) {
      console.error(`Failed to record usage for skill ${skillId}:`, error);
    }
  }

  /**
   * Derive a new skill from one or more learning entries
   */
  async deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
  ): Promise<ISkill> {
    const skill: ISkill = await this.createSkill({
      ...skillDef,
      derived_from: learningIds,
    });

    this.logActivity({
      event_type: "skill.derived",
      target: skill.skill_id,
      metadata: { learning_ids: learningIds },
    });

    return skill;
  }

  /**
   * Rebuild the skill index by scanning the filesystem
   */
  async rebuildIndex(): Promise<void> {
    const index = await this.buildIndex();
    await this.saveIndex(index);
  }

  // ===== Private Utilities =====

  private async findSkillPath(skillId: string): Promise<string | null> {
    if (!this.skillsDir) await this.initialize();

    // 1. Check project skills
    if (this.projectSkillsDir) {
      const projectPath = join(this.projectSkillsDir, `${skillId}.json`);
      if (await exists(projectPath)) return projectPath;
    }

    // 2. Check global skills
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

  // Build skill index
  private async buildIndex(): Promise<ISkillIndex> {
    const skills: ISkillIndexEntry[] = [];
    const files = await this.findSkillFiles(this.skillsDir!);

    for (const file of files) {
      try {
        const content = await Deno.readTextFile(file);
        const skill = SkillSchema.parse(JSON.parse(content)) as ISkill;

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

  // Load index from file or build it
  private async loadIndex(): Promise<ISkillIndex> {
    if (!this.skillsDir) await this.initialize();
    const indexPath = join(this.skillsDir!, "index.json");

    try {
      const content = await Deno.readTextFile(indexPath);
      return JSON.parse(content) as ISkillIndex;
    } catch {
      // Index not found or invalid, build it
      const index = await this.buildIndex();
      await this.saveIndex(index);
      return index;
    }
  }

  // Save index to file
  private async saveIndex(index: ISkillIndex): Promise<void> {
    if (!this.skillsDir) return;
    const indexPath = join(this.skillsDir!, "index.json");
    await Deno.writeTextFile(indexPath, JSON.stringify(index, null, 2));
  }

  // Write skill to file
  private async writeSkillToFile(skill: ISkill, path: string): Promise<void> {
    await Deno.writeTextFile(path, JSON.stringify(skill, null, 2));
  }

  // Log activity to database
  private logActivity(event: {
    event_type: string;
    target: string;
    metadata?: Record<string, JSONValue>;
  }): void {
    this.db.logActivity(
      ActivityActor.SYSTEM,
      event.event_type,
      event.target,
      toSafeJson(event.metadata || {}) as JSONObject,
    );
  }
}
