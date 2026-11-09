/**
 * @module MemoryCommands
 * @path apps/exactl/src/commands/memory_commands.ts
 * @description Provides CLI commands for interacting with Memory Banks, including list, search, project, execution, and proposal management.
 * @architectural-layer CLI
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "apps/daemon/main.ts"]
 */

import * as pathBuilders from "@exaix/shared";
import { ENV_PORTAL_ALIAS } from "@exaix/core";
import {
  computeSkillContentSha256,
  createSkillOperationContext,
  type ISkillOperationContext,
  SkillAuditUnavailableError,
  SkillMutationError,
  SkillUnavailableError,
} from "@exaix/core/skills";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { MemoryAutoApprovalAdapter } from "../../../../apps/common/adapters/memory_auto_approval_adapter.ts";
import { type MemoryBankSource, MemoryScope, MemoryType, SkillDiagnosticSeverity } from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import type { SkillDefinition } from "@exaix/schemas/memory_bank.ts";
import type { ISkillMatchRequest, ISkillsService, Opt, Reason } from "@exaix/core/types";
import type {
  IExecutionMemory,
  ILearning,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
  ISkill,
  ISkillMatch,
} from "@exaix/schemas/memory_bank.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { MEMORY_COMMAND_DEFAULTS } from "@exaix/cli/config.ts";
import {
  type ISkillRevisionRow,
  type ISkillTraceRow,
  MemoryFormatter,
} from "@exaix/cli/formatters/memory_formatter.ts";
import type { IMemoryBankSummary, OutputFormat } from "@exaix/cli/types/memory_types.ts";
import type {
  ISkillApproveResult,
  ISkillDeprecateResult,
  ISkillListResult,
  ISkillRevisionDetail,
  ISkillShowResult,
  ISkillValidateResult,
} from "./skill_results.ts";
import type { IIndexRebuildResult, IProjectListRow, IProposalApproval } from "./memory_results.ts";

const CLI_AGENT_ROLE = "cli";

/** Exit code 1 reports a failed read or mutation, 2 reports a malformed argument. */
type SkillExitCode = 1 | 2;

/** A skill command failure the registered command turns into its process exit code. */
export class SkillCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: SkillExitCode = 1,
  ) {
    super(message);
    this.name = "SkillCommandError";
  }
}

const SKILL_REVISION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class MemoryCommands extends BaseCommand {
  private formatter: MemoryFormatter;
  private _autoApprovalService?: MemoryAutoApprovalAdapter;

  constructor(context: ICommandContext) {
    super(context);
    this.formatter = new MemoryFormatter();
  }

  private get autoApprovalService(): MemoryAutoApprovalAdapter {
    if (!this._autoApprovalService) {
      this._autoApprovalService = new MemoryAutoApprovalAdapter(this.config, this.extractor);
    }
    return this._autoApprovalService;
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

  /**
   * Get memory banks summary
   */
  async getSummary(): Promise<IMemoryBankSummary> {
    const projects: string[] = [];
    let executions = 0;
    let lastActivity: string | null = null;

    // List projects
    const projectsDir = pathBuilders.memoryProjectsPath(join(this.config.system.root, this.config.paths.memory));
    if (await exists(projectsDir)) {
      for await (const entry of Deno.readDir(projectsDir)) {
        if (entry.isDirectory) {
          projects.push(entry.name);
        }
      }
    }

    // Count executions and find last activity
    const executionDir = pathBuilders.memoryExecutionPath(join(this.config.system.root, this.config.paths.memory));
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
    const executionDir = pathBuilders.memoryExecutionPath(join(this.config.system.root, this.config.paths.memory));
    if (await exists(executionDir)) {
      for await (const entry of Deno.readDir(executionDir)) {
        if (entry.isDirectory) {
          count++;
        }
      }
    }
    return count;
  }

  // Memory Search Command

  async search(
    query: string,
    options?: Opt<{
      portal?: string;
      tags?: string[];
      limit?: number;
      useEmbeddings?: boolean;
    }, Reason.QueryFilter>,
  ): Promise<IMemorySearchResult[]> {
    const limit = options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT;

    // Use advanced search if tags are specified
    if (options?.tags && options.tags.length > 0) {
      return await this.memoryBank.searchMemoryAdvanced({
        tags: options.tags,
        keyword: query,
        portal: options.portal,
        limit,
      });
    }
    if (options?.useEmbeddings) {
      const embeddingResults = await this.embedding.searchByEmbedding(query, {
        limit,
      });
      return embeddingResults.map((r) => ({
        type: MemoryType.LEARNING,
        title: r.title,
        summary: r.summary,
        relevance_score: r.similarity,
        id: r.id,
      }));
    }
    return await this.memoryBank.searchMemory(query, {
      portal: options?.portal,
      limit,
    });
  }

  // Project Commands

  async projectList(): Promise<IProjectListRow[]> {
    const projects: IProjectListRow[] = [];

    const projectsDir = pathBuilders.memoryProjectsPath(join(this.config.system.root, this.config.paths.memory));
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

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async projectShow(portal: string): Promise<IProjectMemory> {
    const projectMem = await this.memoryBank.getProjectMemory(portal);

    if (!projectMem) {
      throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `Project memory not found for portal "${portal}"`);
    }

    return projectMem;
  }

  // Execution Commands

  async executionList(
    options?: Opt<{
      portal?: string;
      limit?: number;
    }, Reason.OptionalInput>,
  ): Promise<IExecutionMemory[]> {
    return await this.memoryBank.getExecutionHistory(
      options?.portal,
      options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT,
    );
  }

  async executionShow(traceId: string): Promise<IExecutionMemory> {
    const execution = await this.memoryBank.getExecutionByTraceId(traceId);

    if (!execution) {
      throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `Execution not found for trace ID "${traceId}"`);
    }

    return execution;
  }

  // Global Memory Commands

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

  async demote(learningId: string, targetPortal: string): Promise<string> {
    try {
      await this.memoryBank.demoteLearning(learningId, targetPortal);
      return `ILearning demoted successfully.\nID: ${learningId}\nTo: ${targetPortal}`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  async deleteLearning(learningId: string, reason?: Opt<string, Reason.OptionalInput>): Promise<void> {
    await this.memoryBank.deleteLearning(learningId, reason);
  }

  // Pending Proposals Commands

  async pendingList(eligible = false): Promise<IMemoryUpdateProposal[]> {
    return eligible ? await this.autoApprovalService.listEligible() : await this.extractor.listPending();
  }

  async pendingShow(proposalId: string): Promise<IMemoryUpdateProposal> {
    const proposal = await this.extractor.getPending(proposalId);

    if (!proposal) {
      throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `Proposal not found: ${proposalId}`);
    }

    return proposal;
  }

  async pendingApprove(proposalId: string): Promise<IProposalApproval> {
    const proposal = await this.pendingShow(proposalId);
    await this.extractor.approvePending(proposalId);
    return {
      id: proposalId,
      title: proposal.learning.title,
      mergedTo: proposal.target_project || MemoryScope.GLOBAL,
    };
  }

  /** The proposals that the auto-approval rules would approve now. It changes nothing. */
  async pendingApproveDryRun(): Promise<IMemoryUpdateProposal[]> {
    return await this.autoApprovalService.listEligible();
  }

  async pendingReject(proposalId: string, reason: string): Promise<void> {
    await this.pendingShow(proposalId);
    await this.extractor.rejectPending(proposalId, reason);
  }

  /** Approves every pending proposal and skips the ones that fail. It returns the approvals. */
  async pendingApproveAll(): Promise<IProposalApproval[]> {
    const approvals: IProposalApproval[] = [];
    for (const proposal of await this.extractor.listPending()) {
      try {
        approvals.push(await this.pendingApprove(proposal.id || ""));
      } catch {
        // A failed approval is skipped and the others continue.
      }
    }
    return approvals;
  }

  // Rebuild Index Command

  async rebuildIndex(
    options?: Opt<{ includeEmbeddings?: boolean }, Reason.OptionalInput>,
  ): Promise<IIndexRebuildResult> {
    if (options?.includeEmbeddings) {
      await this.memoryBank.rebuildIndicesWithEmbeddings(this.embedding);
      const stats = await this.embedding.getStats();
      return { embeddings: stats.total };
    }
    await this.memoryBank.rebuildIndices();
    return { embeddings: null };
  }

  // Skills Commands

  async skillList(options: {
    category?: MemoryBankSource;
    portal?: Opt<string, Reason.OptionalInput>;
    /** Also report diagnostics for folders that did not load. */
    all?: boolean;
  } = {}): Promise<ISkillListResult> {
    return await this.skillOperation(async () => {
      await this.skills.initialize();
      const operation = cliSkillContext(this.skills, options.portal);
      const skills = await this.skills.listSkills({ source: options.category }, operation);
      if (!options.all) return { skills };
      return { skills, diagnostics: await this.skills.listDiagnostics(operation) };
    });
  }

  async skillShow(
    skillId: string,
    portal?: Opt<string, Reason.OptionalInput>,
  ): Promise<ISkillShowResult> {
    return await this.skillOperation(async () => {
      await this.skills.initialize();
      // `getSkill` resolves active skills only. A draft awaiting review must still be shown.
      const operation = cliSkillContext(this.skills, portal);
      const skill = await this.skills.getSkill(skillId, operation) ??
        (await this.skills.listSkills(undefined, operation)).find((candidate) => candidate.skill_id === skillId) ??
        null;

      if (!skill) {
        throw new SkillCommandError(`Skill not found: ${skillId}`, 1);
      }

      return { skill, usage: await this.skills.getUsageSummary(skill.skill_id, operation) };
    });
  }

  /** Historical content of one stored revision. It never grants injection authority. */
  async skillShowRevision(
    skillId: string,
    revisionId: string,
    portal: Opt<string, Reason.OptionalInput>,
  ): Promise<ISkillRevisionDetail> {
    if (!SKILL_REVISION_ID_PATTERN.test(revisionId)) {
      throw new SkillCommandError(`Argument error: --revision must be a revision UUID, got "${revisionId}"`, 2);
    }
    return await this.skillOperation(async () => {
      const operation = cliSkillContext(this.skills, portal);
      const record = await this.skills.getRevision(revisionId, operation);
      if (!record || record.skillName !== skillId) {
        throw new SkillCommandError(`Revision ${revisionId} of skill ${skillId} was not found`, 1);
      }
      const usage = (await this.skills.getUsageSummary(skillId, operation)).revisions.find((entry) =>
        entry.revisionId === revisionId
      );
      return {
        revisionId: record.revisionId,
        skillName: record.skillName,
        contentSha256: await computeSkillContentSha256(record.snapshot),
        firstSeenAt: record.firstSeenAt,
        skillMd: record.snapshot.skill_md,
        exaixYaml: record.snapshot.exaix_yaml,
        references: record.snapshot.references,
        origin: usage ? { rootKind: usage.rootKind, sourcePath: usage.sourcePath } : null,
        summary: { useCount: usage?.useCount ?? 0, lastUsedAt: usage?.lastUsedAt ?? null },
      };
    });
  }

  /** Activates a reviewed draft. The revision must be the one the operator reviewed. */
  async skillApprove(
    name: string,
    revisionId: string,
    options: { portal?: Opt<string, Reason.OptionalInput> } = {},
  ): Promise<ISkillApproveResult> {
    this.requireSkillName(name);
    if (!SKILL_REVISION_ID_PATTERN.test(revisionId)) {
      throw new SkillCommandError(`Argument error: --revision must be a revision UUID, got "${revisionId}"`, 2);
    }
    return await this.skillOperation(async () => {
      await this.skills.initialize();
      const operation = cliSkillContext(this.skills, options.portal);
      const active = await this.skills.approveSkill(name, revisionId, operation);
      return { name, reviewedRevisionId: revisionId, activeRevisionId: active.id, status: active.status };
    });
  }

  /** Takes an active or draft skill out of matching. Repeating it is a no-op. */
  async skillDeprecate(
    name: string,
    options: { portal?: Opt<string, Reason.OptionalInput> } = {},
  ): Promise<ISkillDeprecateResult> {
    this.requireSkillName(name);
    return await this.skillOperation(async () => {
      await this.skills.initialize();
      const deprecated = await this.skills.deprecateSkill(name, cliSkillContext(this.skills, options.portal));
      return { name, revisionId: deprecated.id, status: deprecated.status };
    });
  }

  /** Every stored revision of one skill, including ones whose folder was deleted. */
  async skillRevisions(
    name: string,
    options: { portal?: Opt<string, Reason.OptionalInput> } = {},
  ): Promise<ISkillRevisionRow[]> {
    this.requireSkillName(name);
    return await this.skillOperation(async () => {
      const operation = cliSkillContext(this.skills, options.portal);
      const records = await this.skills.listRevisions(name, operation);
      const usage = await this.skills.getUsageSummary(name, operation);
      return await Promise.all(records.map(async (record) => {
        const used = usage.revisions.find((entry) => entry.revisionId === record.revisionId);
        return {
          revisionId: record.revisionId,
          contentSha256: await computeSkillContentSha256(record.snapshot),
          firstSeenAt: record.firstSeenAt,
          useCount: used?.useCount ?? 0,
          lastUsedAt: used?.lastUsedAt ?? null,
        };
      }));
    });
  }

  /** Per-call skill usage on one trace, joined to the snapshot each call used. */
  async skillUsageByTrace(
    traceId: string,
    options: { portal?: Opt<string, Reason.OptionalInput> } = {},
  ): Promise<ISkillTraceRow[]> {
    if (traceId.trim().length === 0) throw new SkillCommandError("Argument error: --trace needs a trace id", 2);
    return await this.skillOperation(async () => {
      const records = await this.skills.usageByTrace(traceId, cliSkillContext(this.skills, options.portal));
      return await Promise.all(records.map(async (record) => ({
        callId: record.callId,
        skillName: record.skillName,
        revisionId: record.revisionId,
        contentSha256: await computeSkillContentSha256(record.snapshot),
        matchSource: record.matchSource,
        renderMode: record.renderMode,
        submissionKind: record.submissionKind,
        round: record.round,
        attempt: record.attempt,
        rootKind: record.rootKind,
        sourcePath: record.sourcePath,
        usedAt: record.usedAt,
        requestId: record.requestId,
        flowId: record.flowId,
        flowStepId: record.flowStepId,
        agentRole: record.agentRole,
        configGeneration: record.configGeneration,
      })));
    });
  }

  /** Typed validation outcomes over the current runtime roots. Writes nothing. Errors fail the exit code. */
  async skillValidate(
    name: Opt<string, Reason.OptionalInput> = undefined,
    options: { portal?: Opt<string, Reason.OptionalInput> } = {},
  ): Promise<ISkillValidateResult> {
    if (name !== undefined) this.requireSkillName(name);
    return await this.skillOperation(async () => {
      const operation = cliSkillContext(this.skills, options.portal);
      const all = await this.skills.listDiagnostics(operation);
      if (name !== undefined) {
        const known = all.some((diagnostic) => diagnostic.name === name) ||
          (await this.skills.listSkills(undefined, operation)).some((skill) => skill.name === name);
        if (!known) throw new SkillCommandError(`Skill not found: ${name}`, 1);
      }
      const diagnostics = name === undefined ? all : all.filter((diagnostic) => diagnostic.name === name);
      const valid = !diagnostics.some((diagnostic) => diagnostic.severity === SkillDiagnosticSeverity.ERROR);
      return { valid, diagnostics };
    });
  }

  private requireSkillName(name: string): void {
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new SkillCommandError(
        `Argument error: "${name}" is not a skill name (lowercase letters, digits, hyphens)`,
        2,
      );
    }
  }

  /** Runs one skill operation, mapping service failures to the command's exit code and a generic message. */
  private async skillOperation<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SkillCommandError) throw error;
      if (error instanceof SkillMutationError) throw new SkillCommandError(`${error.code}: ${error.message}`, 1);
      if (error instanceof SkillUnavailableError) throw new SkillCommandError(`skill_unavailable: ${error.message}`, 1);
      if (error instanceof SkillAuditUnavailableError) {
        throw new SkillCommandError(`skill_audit_unavailable: ${error.message}`, 1);
      }
      throw new SkillCommandError(error instanceof Error ? error.message : "Skill command failed", 1);
    }
  }

  async skillMatch(
    request: string,
    options: {
      taskType?: string;
      tags?: string[];
      limit?: number;
      portal?: Opt<string, Reason.OptionalInput>;
    } = {},
  ): Promise<ISkillMatch[]> {
    return await this.skillOperation(async () => {
      await this.skills.initialize();

      const matchRequest: ISkillMatchRequest = {
        requestText: request,
        taskType: options.taskType,
        tags: options.tags,
      };

      const { matches } = await this.skills.matchSkills(matchRequest, cliSkillContext(this.skills, options.portal));
      return options.limit ? matches.slice(0, options.limit) : matches;
    });
  }

  // Simplified: requires manually-specified learning IDs; no automatic learning selection.
  async skillDerive(options: {
    learningIds?: string[];
    name?: string;
    description?: string;
    instructions?: string;
    portal?: Opt<string, Reason.OptionalInput>;
  } = {}): Promise<ISkill> {
    return await this.skillOperation(async () => {
      await this.skills.initialize();

      if (!options.learningIds || options.learningIds.length === 0) {
        throw new SkillCommandError(
          "Argument error: learning IDs are required for skill derivation. Use --learning-ids <id1,id2,...>",
          2,
        );
      }

      if (!options.name) {
        throw new SkillCommandError("Argument error: skill name is required. Use --name <name>", 2);
      }

      const skillId = toSkillSlug(options.name);
      const skillDef = this.buildDerivedSkillDefinition({
        name: options.name,
        description: options.description,
        instructions: options.instructions,
        learningIds: options.learningIds,
      }, skillId);
      return await this.skills.deriveSkillFromLearnings(
        options.learningIds,
        skillDef,
        cliSkillContext(this.skills, options.portal),
      );
    });
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
  ): SkillDefinition {
    return {
      name: skillId,
      title: options.name,
      description: options.description || `Skill derived from ${options.learningIds.length} learnings`,
      triggers: {
        keywords: [],
        task_types: [],
        file_patterns: [],
        tags: [],
      },
      instructions: options.instructions || "Instructions to be filled in.",
    };
  }

  async skillCreate(
    name: string,
    options: {
      description?: string;
      category?: MemoryBankSource;
      instructions?: string;
      triggersKeywords?: string[];
      triggersTaskTypes?: string[];
      portal?: Opt<string, Reason.OptionalInput>;
    } = {},
  ): Promise<ISkill> {
    return await this.skillOperation(async () => {
      await this.skills.initialize();

      const skillId = toSkillSlug(name);
      const skillDef = this.buildSkillDefinition(name, skillId, options);
      return await this.skills.createSkill(skillDef, cliSkillContext(this.skills, options.portal));
    });
  }

  // Helper: build skill definition object
  private buildSkillDefinition(
    name: string,
    skillId: string,
    options: {
      description?: string;
      instructions?: string;
      triggersKeywords?: string[];
      triggersTaskTypes?: string[];
    },
  ): SkillDefinition {
    return {
      name: skillId,
      title: name,
      description: options.description || `${name} skill`,
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

/** Slug of a free-form skill name: lowercase ASCII words joined by single hyphens. */
function toSkillSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Operation context for CLI skill operations. The portal comes from `--portal`, then `EXA_PORTAL`, else only global skills apply. */
export function cliSkillContext(
  skills: ISkillsService,
  portal: Opt<string, Reason.OptionalInput>,
): ISkillOperationContext {
  return createSkillOperationContext({
    agentRole: CLI_AGENT_ROLE,
    portal: portal ?? Deno.env.get(ENV_PORTAL_ALIAS),
    configGeneration: skills.currentConfigGeneration(),
  });
}
