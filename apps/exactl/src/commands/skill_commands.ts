/**
 * @module SkillCommands
 * @path apps/exactl/src/commands/skill_commands.ts
 * @description Provides the CLI skill operations: list, show, approve, deprecate, match, derive, create and validate.
 * @architectural-layer CLI
 * @related-files ["apps/exactl/src/command_builders/skill_commands.ts", "apps/exactl/src/commands/memory_commands.ts"]
 */

import { ENV_PORTAL_ALIAS, SkillDiagnosticSeverity } from "@exaix/core";
import {
  computeSkillContentSha256,
  createSkillOperationContext,
  type ISkillOperationContext,
  SkillAuditUnavailableError,
  SkillMutationError,
  SkillUnavailableError,
} from "@exaix/core/skills";
import { BaseCommand } from "@exaix/cli/base.ts";
import type { MemoryBankSource } from "@exaix/core";
import type { SkillDefinition } from "@exaix/schemas/memory_bank.ts";
import type { ISkillMatchRequest, ISkillsService, Opt, Reason } from "@exaix/core/types";
import type { ISkill, ISkillMatch } from "@exaix/schemas/memory_bank.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import type { ISkillRevisionRow, ISkillTraceRow } from "@exaix/cli/formatters/memory_formatter.ts";
import type {
  ISkillApproveResult,
  ISkillDeprecateResult,
  ISkillListResult,
  ISkillRevisionDetail,
  ISkillShowResult,
  ISkillValidateResult,
} from "./skill_results.ts";

const CLI_AGENT_ROLE = "cli";

/** A skill command failure. It carries the exit code of its failure class to the root error handler. */
export class SkillCommandError extends ExaCtlError {
  constructor(message: string, code: ExaCtlExitCode = ExaCtlExitCode.FAILURE) {
    super(code, message);
    this.name = "SkillCommandError";
  }
}

function skillNotFound(message: string): SkillCommandError {
  return new SkillCommandError(message, ExaCtlExitCode.NOT_FOUND);
}

function skillUsage(message: string): SkillCommandError {
  return new SkillCommandError(message, ExaCtlExitCode.USAGE);
}

const SKILL_REVISION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class SkillCommands extends BaseCommand {
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
        throw skillNotFound(`Skill not found: ${skillId}`);
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
      throw skillUsage(`Argument error: --revision must be a revision UUID, got "${revisionId}"`);
    }
    return await this.skillOperation(async () => {
      const operation = cliSkillContext(this.skills, portal);
      const record = await this.skills.getRevision(revisionId, operation);
      if (!record || record.skillName !== skillId) {
        throw skillNotFound(`Revision ${revisionId} of skill ${skillId} was not found`);
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
      throw skillUsage(`Argument error: --revision must be a revision UUID, got "${revisionId}"`);
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
    if (traceId.trim().length === 0) {
      throw skillUsage("Argument error: --trace needs a trace id");
    }
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
        if (!known) throw skillNotFound(`Skill not found: ${name}`);
      }
      const diagnostics = name === undefined ? all : all.filter((diagnostic) => diagnostic.name === name);
      const valid = !diagnostics.some((diagnostic) => diagnostic.severity === SkillDiagnosticSeverity.ERROR);
      return { valid, diagnostics };
    });
  }

  private requireSkillName(name: string): void {
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw skillUsage(`Argument error: "${name}" is not a skill name (lowercase letters, digits, hyphens)`);
    }
  }

  /** Runs one skill operation, mapping service failures to the command's exit code and a generic message. */
  private async skillOperation<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SkillCommandError) throw error;
      if (error instanceof SkillMutationError) throw new SkillCommandError(`${error.code}: ${error.message}`);
      if (error instanceof SkillUnavailableError) throw new SkillCommandError(`skill_unavailable: ${error.message}`);
      if (error instanceof SkillAuditUnavailableError) {
        throw new SkillCommandError(`skill_audit_unavailable: ${error.message}`);
      }
      throw new SkillCommandError(error instanceof Error ? error.message : "Skill command failed");
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

  // Simplified: it needs manually specified learning IDs and selects no learning.
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
        throw skillUsage(
          "Argument error: learning IDs are required for skill derivation. Use --learning-ids <id1,id2,...>",
        );
      }

      if (!options.name) {
        throw skillUsage("Argument error: skill name is required. Use --name <name>");
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
