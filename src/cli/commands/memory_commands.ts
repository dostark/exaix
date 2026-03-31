/**
 * @module MemoryCommands
 * @path src/cli/commands/memory_commands.ts
 * @description Provides CLI commands for interacting with Memory Banks, including list, search, project, execution, and proposal management.
 * @architectural-layer CLI
 * * @related-files [src/services/memory_bank.ts, src/cli/main.ts]
 */

import { exists } from "@std/fs";
import { join } from "@std/path";
import { BaseCommand, type ICommandContext } from "../base.ts";
import { MemoryBankSource, MemoryScope, MemoryType, SkillStatus, UIOutputFormat } from "../../shared/enums.ts";
import { type ISkillMatchRequest as SkillMatchRequest } from "../../shared/types/skill.ts";
import type { ILearning, IMemorySearchResult } from "../../shared/schemas/memory_bank.ts";
import { MEMORY_COMMAND_DEFAULTS } from "../cli.config.ts";
import { MemoryFormatter } from "../formatters/memory_formatter.ts";
import { IMemoryBankSummary, OutputFormat } from "../memory_types.ts";

export interface IMemoryCommandsContext extends ICommandContext {}

/**
 * Memory Commands handler
 *
 * Provides CLI interface for Memory Banks operations.
 */
export class MemoryCommands extends BaseCommand {
  private formatter: MemoryFormatter;
  private memoryRoot: string;

  constructor(context: ICommandContext) {
    super(context);
    this.memoryRoot = join(this.context.config.getAll().system.root, this.context.config.getAll().paths.memory);
    this.formatter = new MemoryFormatter();
  }

  private formatOutput<T>(format: OutputFormat, data: T, mdFn: (d: T) => string, tableFn: (d: T) => string): string {
    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(data, null, 2);
      case UIOutputFormat.MARKDOWN:
        return mdFn(data);
      case UIOutputFormat.TABLE:
      default:
        return tableFn(data);
    }
  }

  // ===== Memory List Command =====

  /**
   * List all memory banks with summary information
   *
   * @param format - Output format (table, json, md)
   * @returns Formatted output string
   */
  async list(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const summary = await this.getSummary();

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(summary, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatListMarkdown(summary);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatListTable(summary);
    }
  }

  /**
   * Get memory banks summary
   */
  async getSummary(): Promise<IMemoryBankSummary> {
    const projects: string[] = [];
    let executions = 0;
    let lastActivity: string | null = null;

    // List projects
    const projectsDir = join(this.config.system.root, this.config.paths.memory, "Projects");
    if (await exists(projectsDir)) {
      for await (const entry of Deno.readDir(projectsDir)) {
        if (entry.isDirectory) {
          projects.push(entry.name);
        }
      }
    }

    // Count executions and find last activity
    const executionDir = join(this.config.system.root, this.config.paths.memory, "Execution");
    if (await exists(executionDir)) {
      const executionList = await this.memoryBank.getExecutionHistory(undefined, 1);
      executions = await this.countExecutions();
      if (executionList.length > 0) {
        lastActivity = executionList[0].started_at;
      }
    }

    return {
      projects: projects.sort(),
      executions,
      lastActivity,
    };
  }

  /**
   * Count total executions
   */
  private async countExecutions(): Promise<number> {
    let count = 0;
    const executionDir = join(this.config.system.root, this.config.paths.memory, "Execution");
    if (await exists(executionDir)) {
      for await (const entry of Deno.readDir(executionDir)) {
        if (entry.isDirectory) {
          count++;
        }
      }
    }
    return count;
  }

  // ===== Memory Search Command =====

  /**
   * Search across all memory banks
   *
   * @param query - Search query
   * @param options - Search options
   * @returns Formatted search results
   */
  async search(
    query: string,
    options?: {
      portal?: string;
      tags?: string[];
      limit?: number;
      format?: OutputFormat;
      useEmbeddings?: boolean;
    },
  ): Promise<string> {
    const format = options?.format || MEMORY_COMMAND_DEFAULTS.FORMAT;
    const limit = options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT;

    let results: IMemorySearchResult[];

    // Use advanced search if tags are specified
    if (options?.tags && options.tags.length > 0) {
      results = await this.memoryBank.searchMemoryAdvanced({
        tags: options.tags,
        keyword: query,
        portal: options.portal,
        limit,
      });
    } else if (options?.useEmbeddings) {
      // Use embedding-based search
      const embeddingResults = await this.embedding.searchByEmbedding(query, {
        limit,
      });
      results = embeddingResults.map((r) => ({
        type: MemoryType.LEARNING,
        title: r.title,
        summary: r.summary,
        relevance_score: r.similarity,
        id: r.id,
      }));
    } else {
      // Use standard search
      results = await this.memoryBank.searchMemory(query, {
        portal: options?.portal,
        limit,
      });
    }

    switch (format) {
      case "json":
        return JSON.stringify(results, null, 2);
      case "md":
        return this.formatter.formatSearchMarkdown(query, results);
      case "table":
      default:
        return this.formatter.formatSearchTable(query, results);
    }
  }

  // ===== Project Commands =====

  /**
   * List all project memories
   *
   * @param format - Output format
   * @returns Formatted project list
   */
  async projectList(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const projects: { name: string; patterns: number; decisions: number }[] = [];

    const projectsDir = join(this.config.system.root, this.config.paths.memory, "Projects");
    if (await exists(projectsDir)) {
      for await (const entry of Deno.readDir(projectsDir)) {
        if (entry.isDirectory) {
          const projectMem = await this.memoryBank.getProjectMemory(entry.name);
          if (projectMem) {
            projects.push({
              name: entry.name,
              patterns: projectMem.patterns.length,
              decisions: projectMem.decisions.length,
            });
          }
        }
      }
    }

    projects.sort((a, b) => a.name.localeCompare(b.name));

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(projects, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatProjectListMarkdown(projects);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatProjectListTable(projects);
    }
  }

  /**
   * Show details of a specific project memory
   *
   * @param portal - Portal name
   * @param format - Output format
   * @returns Formatted project details or error message
   */
  async projectShow(portal: string, format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const projectMem = await this.memoryBank.getProjectMemory(portal);

    if (!projectMem) {
      return `Error: Project memory not found for portal "${portal}"`;
    }

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(projectMem, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatProjectShowMarkdown(projectMem);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatProjectShowTable(projectMem);
    }
  }

  // ===== Execution Commands =====

  /**
   * List execution history
   *
   * @param options - List options (portal filter, limit)
   * @returns Formatted execution list
   */
  async executionList(
    options?: {
      portal?: string;
      limit?: number;
      format?: OutputFormat;
    },
  ): Promise<string> {
    const format = options?.format || MEMORY_COMMAND_DEFAULTS.FORMAT;
    const limit = options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT;

    const executions = await this.memoryBank.getExecutionHistory(
      options?.portal,
      limit,
    );

    switch (format) {
      case "json":
        return JSON.stringify(executions, null, 2);
      case "md":
        return this.formatter.formatExecutionListMarkdown(executions);
      case "table":
      default:
        return this.formatter.formatExecutionListTable(executions);
    }
  }

  /**
   * Show details of a specific execution
   *
   * @param traceId - Execution trace ID
   * @param format - Output format
   * @returns Formatted execution details or error message
   */
  async executionShow(traceId: string, format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const execution = await this.memoryBank.getExecutionByTraceId(traceId);

    if (!execution) {
      return `Error: Execution not found for trace ID "${traceId}"`;
    }

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(execution, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatExecutionShowMarkdown(execution);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatExecutionShowTable(execution);
    }
  }

  // ===== Global Memory Commands (Phase 12.8) =====

  /**
   * Show global memory contents
   *
   * @param format - Output format
   * @returns Formatted global memory or error message
   */
  async globalShow(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const globalMem = await this.memoryBank.getGlobalMemory();

    if (!globalMem) {
      return "Global memory not initialized. Run 'exactl memory global init' first.";
    }

    return this.formatOutput(
      format,
      globalMem,
      (d) => this.formatter.formatGlobalShowMarkdown(d),
      (d) => this.formatter.formatGlobalShowTable(d),
    );
  }

  /**
   * List all global learnings
   *
   * @param format - Output format
   * @returns Formatted learnings list
   */
  async globalListLearnings(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const globalMem = await this.memoryBank.getGlobalMemory();

    if (!globalMem) {
      return "Global memory not initialized.";
    }

    const learnings = globalMem.learnings;

    if (learnings.length === 0) {
      return "No learnings in global memory.";
    }

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(learnings, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatGlobalLearningsMarkdown(learnings);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatGlobalLearningsTable(learnings);
    }
  }

  /**
   * Show global memory statistics
   *
   * @param format - Output format
   * @returns Formatted statistics or error message
   */
  async globalStats(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const globalMem = await this.memoryBank.getGlobalMemory();

    if (!globalMem) {
      return "Global memory not initialized. Run 'exactl memory global init' first.";
    }

    return this.formatOutput(
      format,
      globalMem.statistics,
      (d) => this.formatter.formatGlobalStatsMarkdown(d),
      (d) => this.formatter.formatGlobalStatsTable(d),
    );
  }

  /**
   * Promote a learning from project to global scope
   *
   * @param portal - Source portal name
   * @param promotion - Promotion details
   * @returns Success or error message
   */
  async promote(
    portal: string,
    promotion: {
      type: MemoryType.PATTERN | MemoryType.DECISION;
      name: string;
      title: string;
      description: string;
      category: ILearning["category"];
      tags: string[];
      confidence: ILearning["confidence"];
    },
  ): Promise<string> {
    try {
      const learningId = await this.memoryBank.promoteLearning(portal, promotion);
      return `ILearning promoted successfully.\nID: ${learningId}\nTitle: ${promotion.title}\nFrom: ${portal} → global`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  /**
   * Demote a learning from global to project scope
   *
   * @param learningId - ID of the learning to demote
   * @param targetPortal - Target portal name
   * @returns Success or error message
   */
  async demote(learningId: string, targetPortal: string): Promise<string> {
    try {
      await this.memoryBank.demoteLearning(learningId, targetPortal);
      return `ILearning demoted successfully.\nID: ${learningId}\nTo: ${targetPortal}`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  // ===== Pending Proposals Commands =====

  /**
   * List all pending memory update proposals
   *
   * @param format - Output format
   * @returns Formatted list of pending proposals
   */
  async pendingList(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const proposals = await this.extractor.listPending();

    if (proposals.length === 0) {
      return "No pending proposals.";
    }

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(proposals, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatPendingListMarkdown(proposals);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatPendingListTable(proposals);
    }
  }

  /**
   * Show details of a specific pending proposal
   *
   * @param proposalId - Proposal ID
   * @param format - Output format
   * @returns Formatted proposal details
   */
  async pendingShow(proposalId: string, format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const proposal = await this.extractor.getPending(proposalId);

    if (!proposal) {
      return `Proposal not found: ${proposalId}`;
    }

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(proposal, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatPendingShowMarkdown(proposal);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatPendingShowTable(proposal);
    }
  }

  /**
   * Approve a pending proposal
   *
   * @param proposalId - Proposal ID to approve
   * @returns Success or error message
   */
  async pendingApprove(proposalId: string): Promise<string> {
    try {
      const proposal = await this.extractor.getPending(proposalId);
      if (!proposal) {
        return `Proposal not found: ${proposalId}`;
      }

      await this.extractor.approvePending(proposalId);
      return `Proposal approved successfully.\nID: ${proposalId}\nTitle: ${proposal.learning.title}\nMerged to: ${
        proposal.target_project || "global"
      }`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  /**
   * Reject a pending proposal
   *
   * @param proposalId - Proposal ID to reject
   * @param reason - Rejection reason
   * @returns Success or error message
   */
  async pendingReject(proposalId: string, reason: string): Promise<string> {
    try {
      const proposal = await this.extractor.getPending(proposalId);
      if (!proposal) {
        return `Proposal not found: ${proposalId}`;
      }

      await this.extractor.rejectPending(proposalId, reason);
      return `Proposal rejected.\nID: ${proposalId}\nReason: ${reason}`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  /**
   * Approve all pending proposals
   *
   * @returns Success message with count
   */
  async pendingApproveAll(): Promise<string> {
    try {
      const count = await this.extractor.approveAll();
      if (count === 0) {
        return "No pending proposals to approve.";
      }
      return `Approved ${count} proposal(s).`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  // ===== Rebuild Index Command =====

  /**
   * Rebuild all memory bank indices
   *
   * @param options - Options for rebuilding
   * @returns Status message
   */
  async rebuildIndex(options?: { includeEmbeddings?: boolean }): Promise<string> {
    const messages: string[] = [];

    if (options?.includeEmbeddings) {
      // Rebuild with embeddings
      await this.memoryBank.rebuildIndicesWithEmbeddings(this.embedding);
      const stats = await this.embedding.getStats();
      messages.push("Memory bank indices rebuilt successfully.");
      messages.push(`Embeddings regenerated: ${stats.total} learnings embedded.`);
    } else {
      // Standard rebuild
      await this.memoryBank.rebuildIndices();
      messages.push("Memory bank indices rebuilt successfully.");
    }

    return messages.join("\n");
  }

  // ===== Skills Commands (Phase 17) =====

  /**
   * List all skills
   *
   * @param options - List options
   * @returns Formatted list of skills
   */
  async skillList(options: {
    category?: MemoryBankSource;
    format?: OutputFormat;
  } = {}): Promise<string> {
    const format = options.format || UIOutputFormat.TABLE;

    try {
      await this.skills.initialize();
      // Map category to source for the API
      const sourceFilter = options.category as MemoryBankSource | undefined;
      const skills = await this.skills.listSkills({ source: sourceFilter });

      if (skills.length === 0) {
        return options.category ? `No ${options.category} skills found.` : "No skills found.";
      }

      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify(
            skills.map((s) => ({
              skill_id: s.skill_id,
              name: s.name,
              source: s.source,
              scope: s.scope,
              version: s.version,
              status: s.status,
              effectiveness_score: s.effectiveness_score,
            })),
            null,
            2,
          );

        case UIOutputFormat.MARKDOWN:
          return this.formatter.formatSkillListMarkdown(skills);

        case UIOutputFormat.TABLE:
        default:
          return this.formatter.formatSkillListTable(skills);
      }
    } catch (error) {
      return `Error listing skills: ${(error as Error).message}`;
    }
  }

  /**
   * Show details of a specific skill
   *
   * @param skillId - Skill ID to show
   * @param format - Output format
   * @returns Formatted skill details
   */
  async skillShow(skillId: string, format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    try {
      await this.skills.initialize();
      const skill = await this.skills.getSkill(skillId);

      if (!skill) {
        return `Skill not found: ${skillId}`;
      }

      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify(skill, null, 2);

        case UIOutputFormat.MARKDOWN:
          return this.formatter.formatSkillShowMarkdown(skill);
        case UIOutputFormat.TABLE:
        default:
          return this.formatter.formatSkillShowTable(skill);
      }
    } catch (error) {
      return `Error showing skill: ${(error as Error).message}`;
    }
  }

  /**
   * Match skills for a given request
   *
   * @param request - Request text to match against
   * @param options - Match options
   * @returns Matched skills with confidence scores
   */
  async skillMatch(
    request: string,
    options: {
      taskType?: string;
      tags?: string[];
      limit?: number;
      format?: OutputFormat;
    } = {},
  ): Promise<string> {
    const format = options.format || "table";

    try {
      await this.skills.initialize();

      const matchRequest: SkillMatchRequest = {
        requestText: request,
        taskType: options.taskType,
        tags: options.tags,
      };

      const matches = await this.skills.matchSkills(matchRequest);
      const limitedMatches = options.limit ? matches.slice(0, options.limit) : matches;

      if (limitedMatches.length === 0) {
        return "No matching skills found.";
      }

      switch (format) {
        case "json":
          return JSON.stringify(
            limitedMatches.map((m) => ({
              skillId: m.skillId,
              confidence: m.confidence,
              matchedTriggers: m.matchedTriggers,
            })),
            null,
            2,
          );

        case "md":
          return this.formatter.formatSkillMatchMarkdown(limitedMatches);
        case "table":
        default:
          return this.formatter.formatSkillMatchTable(limitedMatches);
      }
    } catch (error) {
      return `Error matching skills: ${(error as Error).message}`;
    }
  }

  /**
   * Derive a skill from learnings (simplified - requires manual learning IDs)
   *
   * @param options - Derivation options
   * @returns Derived skill or error message
   */
  async skillDerive(options: {
    learningIds?: string[];
    name?: string;
    description?: string;
    instructions?: string;
    format?: OutputFormat;
  } = {}): Promise<string> {
    const format = options.format || "table";

    try {
      await this.skills.initialize();

      if (!options.learningIds || options.learningIds.length === 0) {
        return "Error: ILearning IDs are required for skill derivation. Use --learning-ids <id1,id2,...>";
      }

      if (!options.name) {
        return "Error: Skill name is required. Use --name <name>";
      }

      const skillId = options.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      // Ensure required fields for type safety
      const skillDef = this.buildDerivedSkillDefinition({
        name: options.name,
        description: options.description,
        instructions: options.instructions,
        learningIds: options.learningIds,
      }, skillId);
      const derivedSkill = await this.skills.deriveSkillFromLearnings(
        options.learningIds,
        skillDef,
      );

      switch (format) {
        case "json":
          return JSON.stringify(derivedSkill, null, 2);

        case "md":
          return this.formatter.formatSkillShowMarkdown(derivedSkill);
        case "table":
        default:
          return `Derived skill:\n${this.formatter.formatSkillShowTable(derivedSkill)}`;
      }
    } catch (error) {
      return `Error deriving skill: ${(error as Error).message}`;
    }
  }

  // Helper: build derived skill definition object
  private buildDerivedSkillDefinition(
    options: {
      name: string;
      description?: string;
      instructions?: string;
      learningIds: string[];
    },
    skillId: string,
  ) {
    // Determine scope based on portal availability.
    // In CLI context, we check for EXA_PORTAL environment variable.
    const activePortal = Deno.env.get("EXA_PORTAL");
    const scope = activePortal ? MemoryScope.PROJECT : MemoryScope.GLOBAL;

    return {
      skill_id: skillId,
      name: options.name,
      version: "1.0.0",
      source: MemoryBankSource.LEARNED,
      status: SkillStatus.DRAFT,
      description: options.description || `Skill derived from ${options.learningIds.length} learnings`,
      scope,
      triggers: {
        keywords: [],
        task_types: [],
        file_patterns: [],
        tags: [],
      },
      instructions: options.instructions || "Instructions to be filled in.",
    };
  }

  /**
   * Create a new skill from a definition
   *
   * @param name - Skill name
   * @param options - Skill options
   * @returns Created skill confirmation
   */
  async skillCreate(
    name: string,
    options: {
      description?: string;
      category?: MemoryBankSource;
      instructions?: string;
      triggersKeywords?: string[];
      triggersTaskTypes?: string[];
      format?: OutputFormat;
    } = {},
  ): Promise<string> {
    const format = options.format || UIOutputFormat.TABLE;

    try {
      await this.skills.initialize();

      const skillId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const location = options.category || MemoryBankSource.PROJECT;

      const skillDef = this.buildSkillDefinition(name, skillId, location, options);
      const skill = await this.skills.createSkill(skillDef);

      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify(skill, null, 2);

        case UIOutputFormat.MARKDOWN:
        case UIOutputFormat.TABLE:
        default:
          return `Created skill: ${skill.skill_id} (${skill.name}) in ${location}/`;
      }
    } catch (error) {
      return `Error creating skill: ${(error as Error).message}`;
    }
  }

  // Helper: build skill definition object
  private buildSkillDefinition(
    name: string,
    skillId: string,
    location: MemoryBankSource,
    options: {
      description?: string;
      instructions?: string;
      triggersKeywords?: string[];
      triggersTaskTypes?: string[];
    },
  ) {
    // Determine scope based on category and portal availability.
    // Core and Learned (Global) always use GLOBAL scope.
    // User/Project use PROJECT scope if a portal is active, otherwise fall back to GLOBAL.
    const activePortal = Deno.env.get("EXA_PORTAL");
    const scope = (location === MemoryBankSource.CORE || location === MemoryBankSource.LEARNED)
      ? MemoryScope.GLOBAL
      : (activePortal ? MemoryScope.PROJECT : MemoryScope.GLOBAL);

    return {
      skill_id: skillId,
      name,
      version: "1.0.0",
      description: options.description || `${name} skill`,
      source: location === MemoryBankSource.LEARNED ? MemoryBankSource.LEARNED : MemoryBankSource.USER,
      scope,
      status: SkillStatus.DRAFT,
      instructions: options.instructions || "No instructions provided.",
      triggers: {
        keywords: options.triggersKeywords || [],
        task_types: options.triggersTaskTypes || [],
        file_patterns: [],
        tags: [],
      },
    };
  }
}
