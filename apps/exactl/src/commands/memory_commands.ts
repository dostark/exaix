/**
 * @module MemoryCommands
 * @path apps/exactl/src/commands/memory_commands.ts
 * @description Provides CLI commands for interacting with Memory Banks, including list, search, project, execution, and proposal management.
 * @architectural-layer CLI
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "apps/daemon/main.ts"]
 */

import { DEFAULT_EXECUTION_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH, ENV_PORTAL_ALIAS } from "@exaix/core";
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
import {
  DEFAULT_NONE_VALUE,
  type MemoryBankSource,
  MemoryScope,
  MemoryType,
  SkillDiagnosticSeverity,
} from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import type { SkillDefinition } from "@exaix/schemas/memory_bank.ts";
import type { ISkillMatchRequest, ISkillsService, Opt, Reason } from "@exaix/core/types";
import type { ILearning, IMemorySearchResult } from "@exaix/schemas/memory_bank.ts";
import { MEMORY_COMMAND_DEFAULTS } from "@exaix/cli/config.ts";
import {
  type ISkillRevisionRow,
  type ISkillTraceRow,
  MemoryFormatter,
} from "@exaix/cli/formatters/memory_formatter.ts";
import type { IMemoryBankSummary, OutputFormat } from "@exaix/cli/types/memory_types.ts";

export interface IMemoryCommandsContext extends ICommandContext {}

const CLI_AGENT_ROLE = "cli";

/** Exit code 1 reports a failed read or mutation, 2 reports a malformed argument. */
export type SkillExitCode = 1 | 2;

/** A skill command failure the registered command turns into its process exit code. */
export class SkillCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: SkillExitCode = 1,
    readonly output?: Opt<string, Reason.OptionalInput>,
  ) {
    super(message);
    this.name = "SkillCommandError";
  }
}

const SKILL_REVISION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class MemoryCommands extends BaseCommand {
  private formatter: MemoryFormatter;
  private memoryRoot: string;
  private _autoApprovalService?: MemoryAutoApprovalAdapter;

  constructor(context: ICommandContext) {
    super(context);
    this.memoryRoot = join(this.context.config.getAll().system.root, this.context.config.getAll().paths.memory);
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

  // Memory List Command

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
    const projectsDir = join(this.config.system.root, this.config.paths.memory, DEFAULT_PROJECTS_MEMORY_PATH);
    if (await exists(projectsDir)) {
      for await (const entry of Deno.readDir(projectsDir)) {
        if (entry.isDirectory) {
          projects.push(entry.name);
        }
      }
    }

    // Count executions and find last activity
    const executionDir = join(this.config.system.root, this.config.paths.memory, DEFAULT_EXECUTION_MEMORY_PATH);
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

  // Memory Search Command

  async search(
    query: string,
    options?: Opt<{
      portal?: string;
      tags?: string[];
      limit?: number;
      format?: OutputFormat;
      useEmbeddings?: boolean;
    }, Reason.QueryFilter>,
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
      case UIOutputFormat.JSON:
        return JSON.stringify(results, null, 2);
      case "md":
        return this.formatter.formatSearchMarkdown(query, results);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatSearchTable(query, results);
    }
  }

  // Project Commands

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

  // Execution Commands

  async executionList(
    options?: Opt<{
      portal?: string;
      limit?: number;
      format?: OutputFormat;
    }, Reason.OptionalInput>,
  ): Promise<string> {
    const format = options?.format || MEMORY_COMMAND_DEFAULTS.FORMAT;
    const limit = options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT;

    const executions = await this.memoryBank.getExecutionHistory(
      options?.portal,
      limit,
    );

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(executions, null, 2);
      case "md":
        return this.formatter.formatExecutionListMarkdown(executions);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatExecutionListTable(executions);
    }
  }

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

  async deleteLearning(learningId: string, reason?: Opt<string, Reason.OptionalInput>): Promise<string> {
    try {
      await this.memoryBank.deleteLearning(learningId, reason);
      return `ILearning deleted successfully.\nID: ${learningId}`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  // Pending Proposals Commands

  async pendingList(eligible = false, format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const proposals = eligible ? await this.autoApprovalService.listEligible() : await this.extractor.listPending();

    if (proposals.length === 0) {
      return eligible ? "No eligible proposals for auto-approval." : "No pending proposals.";
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

  async pendingApprove(
    proposalId?: Opt<string, Reason.OptionalInput>,
    dryRun = false,
  ): Promise<string> {
    if (dryRun) {
      if (proposalId) {
        return "Error: --dry-run is only supported without a proposal ID. Use `exactl memory pending approve --dry-run`.";
      }
      return this.pendingApproveDryRun();
    }

    if (!proposalId) {
      return "Error: proposal ID is required unless --dry-run is used.";
    }

    try {
      const proposal = await this.extractor.getPending(proposalId);
      if (!proposal) {
        return `Proposal not found: ${proposalId}`;
      }

      await this.extractor.approvePending(proposalId);
      return `Proposal approved successfully.\nID: ${proposalId}\nTitle: ${proposal.learning.title}\nMerged to: ${
        proposal.target_project || MemoryScope.GLOBAL
      }`;
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }

  private async pendingApproveDryRun(): Promise<string> {
    const eligible = await this.autoApprovalService.listEligible();
    if (eligible.length === 0) {
      return "No proposals are currently eligible for auto-approval.";
    }

    return this.formatter.formatPendingDryRunTable(eligible);
  }

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

  // Rebuild Index Command

  async rebuildIndex(
    options?: Opt<{ includeEmbeddings?: boolean }, Reason.OptionalInput>,
  ): Promise<string> {
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

  // Skills Commands

  async skillList(options: {
    category?: MemoryBankSource;
    format?: OutputFormat;
    portal?: Opt<string, Reason.OptionalInput>;
    /** Also report diagnostics for folders that did not load. */
    all?: boolean;
  } = {}): Promise<string> {
    const format = options.format || UIOutputFormat.TABLE;

    return await this.skillOperation(async () => {
      await this.skills.initialize();
      // Map category to source for the API
      const sourceFilter = options.category as MemoryBankSource | undefined;
      const operation = cliSkillContext(this.skills, options.portal);
      const skills = await this.skills.listSkills({ source: sourceFilter }, operation);
      if (options.all) {
        const diagnostics = await this.skills.listDiagnostics(operation);
        if (format === UIOutputFormat.JSON) return JSON.stringify({ skills, diagnostics }, null, 2);
        const listing = skills.length === 0 ? "No skills found." : this.formatter.formatSkillListTable(skills);
        return `${listing}\n\n${this.formatter.formatSkillDiagnostics(diagnostics)}`;
      }

      if (skills.length === 0) {
        return options.category ? `No ${options.category} skills found.` : "No skills found.";
      }

      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify(
            skills.map((s) => ({
              skill_id: s.skill_id,
              name: s.title,
              source: s.source,
              scope: s.scope,
              revision_id: s.id,
              status: s.status,
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
    });
  }

  async skillShow(
    skillId: string,
    format: OutputFormat = UIOutputFormat.TABLE,
    portal?: Opt<string, Reason.OptionalInput>,
    revision?: Opt<string, Reason.OptionalInput>,
  ): Promise<string> {
    if (revision !== undefined) return await this.skillShowRevision(skillId, revision, format, portal);
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

      const usage = await this.skills.getUsageSummary(skill.skill_id, operation);
      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify({ ...skill, usage }, null, 2);

        case UIOutputFormat.MARKDOWN:
          return `${this.formatter.formatSkillShowMarkdown(skill)}\n\n${this.formatter.formatSkillUsage(usage)}`;
        case UIOutputFormat.TABLE:
        default:
          return `${this.formatter.formatSkillShowTable(skill)}\n\n${this.formatter.formatSkillUsage(usage)}`;
      }
    });
  }

  /** Historical content of one stored revision. It never grants injection authority. */
  private async skillShowRevision(
    skillId: string,
    revisionId: string,
    format: OutputFormat,
    portal: Opt<string, Reason.OptionalInput>,
  ): Promise<string> {
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
      const dto = {
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
      if (format === UIOutputFormat.JSON) return JSON.stringify(dto, null, 2);
      const lines = [
        `Skill ${dto.skillName} revision ${dto.revisionId}`,
        `  sha256 ${dto.contentSha256}`,
        `  first seen ${dto.firstSeenAt}`,
        `  origin ${dto.origin ? `${dto.origin.rootKind}/${dto.origin.sourcePath}` : "never used"}`,
        `  ${dto.summary.useCount} use(s), last used ${dto.summary.lastUsedAt ?? "never"}`,
        "",
        "SKILL.md:",
        dto.skillMd,
        "",
        "exaix.yaml:",
        dto.exaixYaml ?? DEFAULT_NONE_VALUE,
      ];
      for (const reference of dto.references) lines.push("", `${reference.path}:`, reference.content);
      return lines.join("\n");
    });
  }

  /** Activates a reviewed draft. The revision must be the one the operator reviewed. */
  async skillApprove(
    name: string,
    revisionId: string,
    options: { portal?: Opt<string, Reason.OptionalInput>; format?: OutputFormat } = {},
  ): Promise<string> {
    this.requireSkillName(name);
    if (!SKILL_REVISION_ID_PATTERN.test(revisionId)) {
      throw new SkillCommandError(`Argument error: --revision must be a revision UUID, got "${revisionId}"`, 2);
    }
    return await this.skillOperation(async () => {
      await this.skills.initialize();
      const operation = cliSkillContext(this.skills, options.portal);
      const active = await this.skills.approveSkill(name, revisionId, operation);
      if (options.format === UIOutputFormat.JSON) {
        return JSON.stringify(
          {
            name,
            reviewedRevisionId: revisionId,
            activeRevisionId: active.id,
            status: active.status,
          },
          null,
          2,
        );
      }
      return `Approved skill: ${name}\nReviewed revision: ${revisionId}\nActive revision: ${active.id}`;
    });
  }

  /** Takes an active or draft skill out of matching. Repeating it is a no-op. */
  async skillDeprecate(
    name: string,
    options: { portal?: Opt<string, Reason.OptionalInput>; format?: OutputFormat } = {},
  ): Promise<string> {
    this.requireSkillName(name);
    return await this.skillOperation(async () => {
      await this.skills.initialize();
      const deprecated = await this.skills.deprecateSkill(name, cliSkillContext(this.skills, options.portal));
      if (options.format === UIOutputFormat.JSON) {
        return JSON.stringify({ name, revisionId: deprecated.id, status: deprecated.status }, null, 2);
      }
      return `Skill ${name} is deprecated (revision ${deprecated.id}). Approve a reviewed revision to reactivate it.`;
    });
  }

  /** Every stored revision of one skill, including ones whose folder was deleted. */
  async skillRevisions(
    name: string,
    options: { portal?: Opt<string, Reason.OptionalInput>; format?: OutputFormat } = {},
  ): Promise<string> {
    this.requireSkillName(name);
    return await this.skillOperation(async () => {
      const operation = cliSkillContext(this.skills, options.portal);
      const records = await this.skills.listRevisions(name, operation);
      const usage = await this.skills.getUsageSummary(name, operation);
      const rows: ISkillRevisionRow[] = await Promise.all(records.map(async (record) => {
        const used = usage.revisions.find((entry) => entry.revisionId === record.revisionId);
        return {
          revisionId: record.revisionId,
          contentSha256: await computeSkillContentSha256(record.snapshot),
          firstSeenAt: record.firstSeenAt,
          useCount: used?.useCount ?? 0,
          lastUsedAt: used?.lastUsedAt ?? null,
        };
      }));
      return options.format === UIOutputFormat.JSON
        ? JSON.stringify(rows, null, 2)
        : this.formatter.formatSkillRevisions(name, rows);
    });
  }

  /** Per-call skill usage on one trace, joined to the snapshot each call used. */
  async skillUsageByTrace(
    traceId: string,
    options: { portal?: Opt<string, Reason.OptionalInput>; format?: OutputFormat } = {},
  ): Promise<string> {
    if (traceId.trim().length === 0) throw new SkillCommandError("Argument error: --trace needs a trace id", 2);
    return await this.skillOperation(async () => {
      const records = await this.skills.usageByTrace(traceId, cliSkillContext(this.skills, options.portal));
      const rows: ISkillTraceRow[] = await Promise.all(records.map(async (record) => ({
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
      return options.format === UIOutputFormat.JSON
        ? JSON.stringify(rows, null, 2)
        : this.formatter.formatSkillTrace(traceId, rows);
    });
  }

  /** Typed validation outcomes over the current runtime roots. Writes nothing. Errors fail the exit code. */
  async skillValidate(
    name: Opt<string, Reason.OptionalInput> = undefined,
    options: { portal?: Opt<string, Reason.OptionalInput>; format?: OutputFormat } = {},
  ): Promise<string> {
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
      const output = options.format === UIOutputFormat.JSON
        ? JSON.stringify({ valid, diagnostics }, null, 2)
        : `${valid ? "Catalog is valid." : "Catalog has errors."}\n${
          this.formatter.formatSkillDiagnostics(diagnostics)
        }`;
      if (!valid) throw new SkillCommandError("Skill validation failed", 1, output);
      return output;
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
  private async skillOperation(run: () => Promise<string>): Promise<string> {
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
      format?: OutputFormat;
      portal?: Opt<string, Reason.OptionalInput>;
    } = {},
  ): Promise<string> {
    const format = options.format || UIOutputFormat.TABLE;

    return await this.skillOperation(async () => {
      await this.skills.initialize();

      const matchRequest: ISkillMatchRequest = {
        requestText: request,
        taskType: options.taskType,
        tags: options.tags,
      };

      const { matches } = await this.skills.matchSkills(matchRequest, cliSkillContext(this.skills, options.portal));
      const limitedMatches = options.limit ? matches.slice(0, options.limit) : matches;

      if (limitedMatches.length === 0) {
        return "No matching skills found.";
      }

      switch (format) {
        case UIOutputFormat.JSON:
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
        case UIOutputFormat.TABLE:
        default:
          return this.formatter.formatSkillMatchTable(limitedMatches);
      }
    });
  }

  // Simplified: requires manually-specified learning IDs; no automatic learning selection.
  async skillDerive(options: {
    learningIds?: string[];
    name?: string;
    description?: string;
    instructions?: string;
    format?: OutputFormat;
    portal?: Opt<string, Reason.OptionalInput>;
  } = {}): Promise<string> {
    const format = options.format || UIOutputFormat.TABLE;

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
      const derivedSkill = await this.skills.deriveSkillFromLearnings(
        options.learningIds,
        skillDef,
        cliSkillContext(this.skills, options.portal),
      );

      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify(derivedSkill, null, 2);

        case "md":
          return this.formatter.formatSkillShowMarkdown(derivedSkill);
        case UIOutputFormat.TABLE:
        default:
          return `Derived draft skill:\n${
            this.formatter.formatSkillShowTable(derivedSkill)
          }\nDraft path: ${derivedSkill.root_kind}/${derivedSkill.path}\nRevision: ${derivedSkill.id}`;
      }
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
      format?: OutputFormat;
      portal?: Opt<string, Reason.OptionalInput>;
    } = {},
  ): Promise<string> {
    const format = options.format || UIOutputFormat.TABLE;

    return await this.skillOperation(async () => {
      await this.skills.initialize();

      const skillId = toSkillSlug(name);
      const skillDef = this.buildSkillDefinition(name, skillId, options);
      const skill = await this.skills.createSkill(skillDef, cliSkillContext(this.skills, options.portal));

      switch (format) {
        case UIOutputFormat.JSON:
          return JSON.stringify(skill, null, 2);

        case UIOutputFormat.MARKDOWN:
        case UIOutputFormat.TABLE:
        default:
          return `Created draft skill: ${skill.skill_id} (${skill.title})\nDraft path: ${skill.root_kind}/${skill.path}\nRevision: ${skill.id}\nReview it, then approve this revision to activate it.`;
      }
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
function cliSkillContext(
  skills: ISkillsService,
  portal: Opt<string, Reason.OptionalInput>,
): ISkillOperationContext {
  return createSkillOperationContext({
    agentRole: CLI_AGENT_ROLE,
    portal: portal ?? Deno.env.get(ENV_PORTAL_ALIAS),
    configGeneration: skills.currentConfigGeneration(),
  });
}
