/**
 * @module SkillsService
 * @path packages/core/src/skills/skills.ts
 * @related-files [packages/core/src/skills/skill_folder_loader.ts, packages/core/src/skills/skill_folder_publisher.ts]
 * @architectural-layer Core
 * @description Manages procedural memory (skills). Reads Agent Skills folders through
 *   SkillFolderLoader over ordered roots, matches them against a request, and publishes
 *   machine-authored skills as draft folders under the guarded publication protocol.
 *   Skills encode domain expertise as reusable instruction modules that agents apply.
 * @visible
 */

import { isAbsolute, join, relative, resolve } from "@std/path";
import { exists } from "@std/fs";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { z } from "zod";
import { createPathSecurity } from "@exaix/tool-runtime";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import {
  type ISkillAuthoring,
  type ISkillSidecar,
  SkillAuthoringSchema,
  SkillAuthoringUpdateSchema,
  SkillFrontmatterSchema,
  SkillSidecarSchema,
} from "@exaix/schemas/skill_folder.ts";
import type { ISkill, ISkillMatch, ISkillTriggers, SkillDefinition, SkillUpdates } from "@exaix/schemas/memory_bank.ts";
import { SkillPinVectorSchema } from "@exaix/schemas/skill_pin.ts";
import type { Config } from "@exaix/schemas/config.ts";
import {
  DEFAULT_SKILL_CONTEXT_CHAR_BUDGET,
  DEFAULT_SKILLS_KEYWORD_MATCH_SATURATION,
  ExaPathDefaults,
} from "../types/constants.ts";
import {
  type MemoryBankSource,
  type MemoryScope,
  SkillDiagnosticReason,
  SkillDiagnosticSeverity,
  SkillInitOutcome,
  SkillMutationErrorCode,
  SkillMutationOperation,
  SkillRootKind,
  SkillStatus,
} from "../types/enums.ts";
import { DomainEventType, type TDomainEventType } from "../events/domain_event_types.ts";
import { EventRegistry, type IEventRegistry } from "../events/event_registry.ts";
import { createNoopEventLogger } from "../logger/noop_event_logger.ts";
import type { IEventLogger } from "../logger/event_logger.ts";
import type { ISkillMatchRequest, ISkillsService } from "../types/mod.ts";
import type { LogMetadata } from "../types/json.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";
import { SKILL_EXAMPLES_HEADING, splitInstructionsAndExamples, stripExamplesSection } from "../func/skill_body.ts";
import { extractKeywords } from "./text_utils.ts";
import { DEFAULT_SKILL_FOLDER_LIMITS, SkillFolderLoader } from "./skill_folder_loader.ts";
import { SkillFolderPublisher } from "./skill_folder_publisher.ts";
import { SkillRevisionStore } from "./skill_revision_store.ts";
import { SkillUsageStore } from "./skill_usage_store.ts";
import { ScopedSkillsService } from "./skill_scoped_view.ts";
import { buildRootContext, canonicalizeSkillText, parseSkillSnapshot } from "./skill_snapshot.ts";
import {
  type ILoadedSkill,
  type IPinnedSkill,
  type IResolvedSkillRoot,
  type ISkillDiagnostic,
  type ISkillFolderLimits,
  type ISkillOperationContext,
  type ISkillPin,
  type ISkillRevisionRecord,
  type ISkillRevisionSnapshot,
  type ISkillSubmission,
  type ISkillUsageRecord,
  type ISkillUsageSummary,
  SkillAuditUnavailableError,
  SkillMutationError,
  SkillUnavailableError,
} from "./skill_types.ts";

export interface ISkillsConfig {
  autoMatch: boolean;
  maxSkillsPerRequest: number;
  skillContextBudget: number;
  matchThreshold: number;
}

/** The current validated config and the checksum that names its generation. */
export interface ISkillsConfigProvider {
  get(): Config;
  getChecksum(): string;
}

/** Filesystem layout the service reads. Without a config provider the layout is fixed at construction. */
export interface ISkillsServiceConfig {
  memoryDir?: Opt<string, Reason.OptionalInput>;
  /** Read-only Blueprint skills root, `<Blueprints>/Skills`. */
  blueprintSkillsDir?: Opt<string, Reason.OptionalInput>;
  /** Selects roots and limits from the current config at each operation. Wins over the fixed layout. */
  configProvider?: Opt<ISkillsConfigProvider, Reason.OptionalDependency>;
}

/** One ordered root entry with its resolved path. A project entry's path is the parent of the portal folders. */
interface IRootEntry {
  kind: SkillRootKind;
  path: string;
}

/** The roots, limits and generation one operation resolves against. Immutable once built. */
interface IRootPlan {
  generation: string;
  entries: readonly IRootEntry[];
  limits: ISkillFolderLimits;
  /** Configured portal aliases, or null when any valid portal name is accepted. */
  portals: ReadonlySet<string> | null;
  diagnostics: readonly ISkillDiagnostic[];
}

const DEFAULT_CONFIG: ISkillsConfig = {
  autoMatch: true,
  maxSkillsPerRequest: 5,
  skillContextBudget: DEFAULT_SKILL_CONTEXT_CHAR_BUDGET,
  matchThreshold: 0.3,
};

/** Directory checked ahead of the shipped catalog for a skill's folder (process lifetime).
 * Lets a `skill-version` arm A/B-compare a skill without editing `Blueprints/Skills/`. The
 * caller must validate this dir via `PathResolver`. `SkillsService` trusts it as-is. */
export const EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR = "EXA_EVAL_SKILL_OVERLAY_DIR";

/** Event source id registered by the service. */
export const SKILLS_SERVICE_SOURCE_ID = "skills-service";

/** Revisions kept for `ensureRevisions`. A caller records right after reading, so a small window suffices. */
const MAX_REMEMBERED_REVISIONS = 256;
const MAX_REMEMBERED_PLANS = 8;
const REVISION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERATION_LENGTH = 16;
const SKILLS_SUBDIR = "Skills";
const LEARNED_SUBDIR = "learned";
const PROJECT_SUBDIR = "project";
const STATE_DIR = ".exa-skill-state";
const LOCK_FILE = "lock";
const STATIC_CONFIG_GENERATION = "static";
const SYSTEM_AGENT_ROLE = "system";
const PORTAL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERVICE_EVENTS: readonly TDomainEventType[] = [
  DomainEventType.SkillsInitialized,
  DomainEventType.SkillsCreated,
  DomainEventType.SkillsUpdated,
  DomainEventType.SkillsDerived,
  DomainEventType.SkillsApproved,
  DomainEventType.SkillsDeprecated,
  DomainEventType.SkillsDeleted,
  DomainEventType.SkillsMutationFailed,
  DomainEventType.SkillsMatchCompleted,
];

export class SkillsService implements ISkillsService {
  private readonly skillsConfig: ISkillsConfig;
  private readonly registry: IEventRegistry;
  private readonly publisher = new SkillFolderPublisher(createPathSecurity());
  private readonly loaders = new Map<string, SkillFolderLoader>();
  private readonly loggerForLoaders: IEventLogger;
  private readonly revisions: SkillRevisionStore;
  private readonly usage: SkillUsageStore;
  /** Immutable snapshots of skills this service returned, so a recorded revision is exactly what a caller saw. */
  private readonly loadedByRevision = new Map<string, ILoadedSkill>();
  /** Root plans by config generation, so an operation that started before a reload keeps its roots. */
  private readonly plans = new Map<string, IRootPlan>();

  constructor(
    private readonly config: ISkillsServiceConfig,
    db: IDatabaseService,
    skillsConfig?: Opt<Partial<ISkillsConfig>, Reason.OptionalInput>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.skillsConfig = { ...DEFAULT_CONFIG, ...skillsConfig };
    this.loggerForLoaders = logger ?? createNoopEventLogger();
    this.registry = new EventRegistry(this.loggerForLoaders);
    this.registry.registerPublisher(SKILLS_SERVICE_SOURCE_ID, SERVICE_EVENTS);
    const storeDeps = { db, logger: this.loggerForLoaders, eventRegistry: this.registry };
    this.revisions = new SkillRevisionStore(storeDeps);
    this.usage = new SkillUsageStore(storeDeps);
  }

  /** A view that binds one operation context. The singleton and every other view stay untouched. */
  forContext(ctx: ISkillOperationContext): ISkillsService {
    return new ScopedSkillsService(this, ctx);
  }

  /** Durably snapshots the canonical content of each revision this service returned. Fails closed. */
  async ensureRevisions(
    revisionIds: readonly string[],
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<void> {
    const operation = ctx ?? this.defaultContext();
    for (const revisionId of revisionIds) {
      const loaded = this.loadedByRevision.get(revisionId);
      if (!loaded) {
        throw new SkillAuditUnavailableError(`No loaded snapshot is available for skill revision ${revisionId}`);
      }
      await this.revisions.record(loaded, operation);
    }
  }

  async getRevision(
    revisionId: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillRevisionRecord | null> {
    if (!REVISION_ID_PATTERN.test(revisionId)) return null;
    return await this.revisions.get(revisionId, ctx ?? this.defaultContext()).catch(() => {
      throw new SkillUnavailableError("", `Skill revision ${revisionId} has a corrupt stored snapshot`);
    });
  }

  async listRevisions(
    name: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillRevisionRecord[]> {
    return await this.revisions.listByName(name, ctx ?? this.defaultContext()).catch(() => {
      throw new SkillUnavailableError(name, `Skill "${name}" has a corrupt stored revision`);
    });
  }

  /** Joins each pin to the immutable snapshot it names. Live files are never read. */
  async resolvePinned(
    pins: readonly ISkillPin[],
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<IPinnedSkill[]> {
    const operation = ctx ?? this.defaultContext();
    const parsed = SkillPinVectorSchema.safeParse(pins);
    if (!parsed.success) {
      throw new SkillUnavailableError("", `Skill pin vector is malformed: ${parsed.error.issues[0]?.message}`);
    }
    const resolved: IPinnedSkill[] = [];
    for (const pin of pins) resolved.push({ pin, loaded: await this.resolveOnePin(pin, operation) });
    return resolved;
  }

  private async resolveOnePin(pin: ISkillPin, operation: ISkillOperationContext): Promise<ILoadedSkill> {
    const fail = (reason: string) => new SkillUnavailableError(pin.name, `Pinned skill "${pin.name}" ${reason}`);
    if (pin.portal !== null && pin.portal !== operation.portal) throw fail("belongs to a different portal");
    if (pin.root_kind === SkillRootKind.PROJECT && pin.portal === null) {
      throw fail("is a project skill without a portal");
    }
    const record = await this.revisions.get(pin.revision_id, operation).catch(() => {
      throw fail("has a corrupt stored snapshot");
    });
    if (!record) throw fail("has no stored snapshot");
    if (record.skillName !== pin.name || record.contentSha256 !== pin.content_sha256) {
      throw fail("does not match its stored snapshot");
    }
    const root: IResolvedSkillRoot = {
      path: pin.source_path,
      kind: pin.root_kind,
      writable: false,
      project: pin.portal,
    };
    const skill = await parseSkillSnapshot(record.snapshot, buildRootContext(root, pin.name)).catch(() => {
      throw fail("has a snapshot that no longer parses");
    });
    return this.remember({
      skill,
      revisionId: record.revisionId,
      contentSha256: record.contentSha256,
      rootKind: pin.root_kind,
      sourcePath: pin.source_path,
      snapshot: record.snapshot,
    });
  }

  /**
   * Records one model submission. The revision snapshots are made durable first, then the complete
   * usage vector is written in one statement. Either failure throws, so no model call follows.
   */
  async recordSubmission(submission: ISkillSubmission, ctx: ISkillOperationContext): Promise<void> {
    await this.ensureRevisions(submission.items.map((item) => item.revisionId), ctx);
    await this.usage.record(submission, ctx);
  }

  async getUsageSummary(
    name: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillUsageSummary> {
    return await this.usage.summary(name, ctx ?? this.defaultContext());
  }

  async usageByTrace(
    traceId: string,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkillUsageRecord[]> {
    return await this.usage.byTrace(traceId, ctx ?? this.defaultContext());
  }

  private remember(loaded: ILoadedSkill): ILoadedSkill {
    this.loadedByRevision.delete(loaded.revisionId);
    this.loadedByRevision.set(loaded.revisionId, loaded);
    while (this.loadedByRevision.size > MAX_REMEMBERED_REVISIONS) {
      const oldest = this.loadedByRevision.keys().next().value;
      if (oldest === undefined) break;
      this.loadedByRevision.delete(oldest);
    }
    return loaded;
  }

  /** Creates the learned root, recovers interrupted publications and journals readiness. */
  async initialize(): Promise<void> {
    const ctx = this.defaultContext();
    const writable = this.writableRoots(ctx);
    try {
      let recovered = 0;
      for (const root of writable) {
        await this.publisher.ensureState(root.path);
        recovered += await this.publisher.withLocks([root.path], "exclusive", () => this.publisher.recover(root.path));
      }
      await this.emit(DomainEventType.SkillsInitialized, ctx, {
        writable_roots: writable.length,
        recovered_operations: recovered,
        outcome: SkillInitOutcome.READY,
      });
    } catch (error) {
      await this.emit(DomainEventType.SkillsInitialized, ctx, {
        writable_roots: writable.length,
        recovered_operations: 0,
        outcome: SkillInitOutcome.FAILED,
      });
      throw error;
    }
  }

  async getSkill(name: string, ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkill | null> {
    const operation = ctx ?? this.defaultContext();
    const loaded = await this.loaderFor(operation).get(name, operation);
    return loaded ? this.remember(loaded).skill : null;
  }

  async listSkills(
    filter?: Opt<{
      status?: SkillStatus;
      scope?: MemoryScope;
      source?: MemoryBankSource;
    }, Reason.QueryFilter>,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<ISkill[]> {
    const operation = ctx ?? this.defaultContext();
    const all = (await this.loaderFor(operation).listAll(operation)).map((loaded) => this.remember(loaded).skill);
    return all.filter((skill) =>
      (!filter?.status || skill.status === filter.status) &&
      (!filter?.scope || skill.scope === filter.scope) &&
      (!filter?.source || skill.source === filter.source)
    );
  }

  async listDiagnostics(ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>): Promise<ISkillDiagnostic[]> {
    const operation = ctx ?? this.defaultContext();
    const found = await this.loaderFor(operation).diagnostics(operation);
    return [...this.planFor(operation).diagnostics, ...found];
  }

  async createSkill(skillDef: SkillDefinition, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.guarded(skillDef.name, SkillMutationOperation.CREATE, ctx, async () => {
      const loaded = await this.publishDraft(skillDef, ctx, undefined);
      await this.emit(DomainEventType.SkillsCreated, ctx, {
        name: loaded.skill.name,
        revision_id: loaded.revisionId,
        status: SkillStatus.DRAFT,
      });
      return loaded.skill;
    });
  }

  async deriveSkillFromLearnings(
    learningIds: string[],
    skillDef: SkillDefinition,
    ctx: ISkillOperationContext,
  ): Promise<ISkill> {
    return await this.guarded(skillDef.name, SkillMutationOperation.DERIVE, ctx, async () => {
      const loaded = await this.publishDraft(skillDef, ctx, learningIds);
      await this.emit(DomainEventType.SkillsDerived, ctx, {
        name: loaded.skill.name,
        revision_id: loaded.revisionId,
        learning_ids: learningIds,
        status: SkillStatus.DRAFT,
      });
      return loaded.skill;
    });
  }

  async updateSkill(name: string, updates: SkillUpdates, ctx: ISkillOperationContext): Promise<ISkill | null> {
    return await this.guarded(name, SkillMutationOperation.UPDATE, ctx, async () => {
      const parsed = this.parseInput(SkillAuthoringUpdateSchema, updates);
      return await this.withWritableOwner(name, ctx, async (current, root) => {
        const snapshot = this.composeUpdate(current, parsed);
        const status = current.skill.status === SkillStatus.DEPRECATED ? SkillStatus.DEPRECATED : SkillStatus.DRAFT;
        const next = await this.replaceFolder(root, current, withStatus(snapshot, status), ctx);
        await this.emit(DomainEventType.SkillsUpdated, ctx, {
          name,
          previous_revision_id: current.revisionId,
          revision_id: next.revisionId,
          status,
        });
        return next.skill;
      });
    }, true);
  }

  async approveSkill(name: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.guarded(name, SkillMutationOperation.APPROVE, ctx, async () => {
      const approved = await this.withWritableOwner(name, ctx, async (current, root) => {
        if (current.revisionId !== expectedRevisionId) {
          throw new SkillMutationError(
            SkillMutationErrorCode.REVISION_MISMATCH,
            `skill "${name}" changed since revision ${expectedRevisionId} was reviewed`,
          );
        }
        if (current.skill.status === SkillStatus.ACTIVE) {
          throw new SkillMutationError(SkillMutationErrorCode.INVALID_TRANSITION, `skill "${name}" is already active`);
        }
        const next = await this.replaceFolder(root, current, withStatus(current.snapshot, SkillStatus.ACTIVE), ctx);
        await this.emit(DomainEventType.SkillsApproved, ctx, {
          name,
          reviewed_revision_id: expectedRevisionId,
          active_revision_id: next.revisionId,
          actor: ctx.agentRole,
        });
        return next.skill;
      });
      if (approved === null) {
        throw new SkillMutationError(SkillMutationErrorCode.NOT_FOUND, `skill "${name}" not found`);
      }
      return approved;
    });
  }

  /** The guarded approve alias. */
  async activateSkill(name: string, expectedRevisionId: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.approveSkill(name, expectedRevisionId, ctx);
  }

  async deprecateSkill(name: string, ctx: ISkillOperationContext): Promise<ISkill> {
    return await this.guarded(name, SkillMutationOperation.DEPRECATE, ctx, async () => {
      const result = await this.withWritableOwner(name, ctx, async (current, root) => {
        if (current.skill.status === SkillStatus.DEPRECATED) return current.skill;
        const next = await this.replaceFolder(root, current, withStatus(current.snapshot, SkillStatus.DEPRECATED), ctx);
        await this.emit(DomainEventType.SkillsDeprecated, ctx, {
          name,
          revision_id: next.revisionId,
          previous_status: current.skill.status,
        });
        return next.skill;
      });
      if (result === null) throw new SkillMutationError(SkillMutationErrorCode.NOT_FOUND, `skill "${name}" not found`);
      return result;
    });
  }

  async deleteSkill(name: string, ctx: ISkillOperationContext): Promise<boolean> {
    return await this.guarded(name, SkillMutationOperation.DELETE, ctx, async () => {
      const removed = await this.withWritableOwner(name, ctx, async (current, root) => {
        await this.publisher.remove(root.path, name);
        await this.emit(DomainEventType.SkillsDeleted, ctx, {
          name,
          revision_id: current.revisionId,
          root_kind: root.kind,
        });
        return true;
      });
      return removed ?? false;
    });
  }

  async matchSkills(
    request: ISkillMatchRequest,
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    const operation = ctx ?? this.defaultContext();
    if (!this.skillsConfig.autoMatch) return { matches: [], totalAvailable: 0 };

    const active = await this.loaderFor(operation).list(operation);
    const matches: Array<ISkillMatch & { skill: ISkill }> = [];
    for (const loaded of active) {
      const { skill } = this.remember(loaded);
      const { confidence, matchedTriggers } = this.calculateTriggerMatch(skill.triggers, request);
      if (confidence >= this.skillsConfig.matchThreshold) {
        matches.push({ skillId: skill.name, revisionId: skill.id, confidence, matchedTriggers, skill });
      }
    }
    matches.sort((a, b) => b.confidence - a.confidence);

    const totalAvailable = matches.length;
    const limited = matches.slice(0, this.skillsConfig.maxSkillsPerRequest);
    const strip = ({ skill: _skill, ...match }: ISkillMatch & { skill: ISkill }): ISkillMatch => match;
    const contextBudgetChars = request.contextBudgetChars;

    if (contextBudgetChars === undefined) {
      await this.logMatchCompleted(operation, limited.map(strip), totalAvailable, false);
      return { matches: limited.map(strip), totalAvailable };
    }

    const budgeted: ISkillMatch[] = [];
    let remainingBudget = contextBudgetChars;
    for (const match of limited) {
      const blockLength = this.formatSkillForPrompt(match.skill).length;
      // Skip an over-budget match and try the next. Matches are confidence-sorted, so a single
      // over-budget top match must not discard smaller matches that still fit.
      if (blockLength > remainingBudget) continue;
      budgeted.push(strip(match));
      remainingBudget -= blockLength;
    }
    await this.logMatchCompleted(operation, budgeted, totalAvailable, budgeted.length < limited.length);
    return { matches: budgeted, totalAvailable };
  }

  async buildSkillContext(
    skillIds: string[],
    ctx?: Opt<ISkillOperationContext, Reason.OptionalContext>,
  ): Promise<string> {
    if (skillIds.length === 0) return "";
    const skills = await Promise.all(skillIds.map((id) => this.getSkill(id, ctx)));
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

  /** Journals the outcome of a skill match. A zero-match outcome is journaled too, since
   *  "no skill applied" is itself a result. */
  private async logMatchCompleted(
    ctx: ISkillOperationContext,
    matches: ISkillMatch[],
    totalAvailable: number,
    budgetTruncated: boolean,
  ): Promise<void> {
    await this.emit(DomainEventType.SkillsMatchCompleted, ctx, {
      matched_skill_ids: matches.map((match) => match.skillId),
      matched_count: matches.length,
      total_available: totalAvailable,
      max_per_request: this.skillsConfig.maxSkillsPerRequest,
      budget_truncated: budgetTruncated,
    });
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
    // trigger's total keyword count: a skill with a long trigger list must not be penalized
    // for the keywords a given request doesn't use.
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

  private formatSkillForPrompt(skill: ISkill): string {
    let block = `#### ${skill.title}\n`;
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

  // Roots, context and events

  private defaultContext(): ISkillOperationContext {
    return {
      portal: null,
      traceId: crypto.randomUUID(),
      requestId: null,
      flowId: null,
      flowStepId: null,
      agentRole: SYSTEM_AGENT_ROLE,
      configGeneration: this.currentConfigGeneration(),
    };
  }

  /** The generation of the config the next operation resolves against. `static` without a config provider. */
  currentConfigGeneration(): string {
    return this.currentPlan().generation;
  }

  /** The plan for the current config, rebuilt only when the config generation moves. */
  private currentPlan(): IRootPlan {
    const provider = this.config.configProvider;
    const generation = provider ? provider.getChecksum().slice(0, GENERATION_LENGTH) : STATIC_CONFIG_GENERATION;
    const known = this.plans.get(generation);
    if (known) return known;
    const plan = provider ? this.planFromConfig(provider.get(), generation) : this.staticPlan();
    this.plans.set(generation, plan);
    while (this.plans.size > MAX_REMEMBERED_PLANS) {
      const oldest = this.plans.keys().next().value;
      if (oldest === undefined) break;
      this.plans.delete(oldest);
    }
    return plan;
  }

  /** The plan an operation resolves against: the generation it was stamped with, else the current one. */
  private planFor(ctx: ISkillOperationContext): IRootPlan {
    return this.plans.get(ctx.configGeneration) ?? this.currentPlan();
  }

  private staticPlan(): IRootPlan {
    const entries: IRootEntry[] = [];
    if (this.config.memoryDir) {
      const skillsDir = join(this.config.memoryDir, SKILLS_SUBDIR);
      entries.push({ kind: SkillRootKind.PROJECT, path: join(skillsDir, PROJECT_SUBDIR) });
      entries.push({ kind: SkillRootKind.LEARNED, path: join(skillsDir, LEARNED_SUBDIR) });
    }
    if (this.config.blueprintSkillsDir) {
      entries.push({ kind: SkillRootKind.BLUEPRINT, path: this.config.blueprintSkillsDir });
    }
    return {
      generation: STATIC_CONFIG_GENERATION,
      entries,
      limits: DEFAULT_SKILL_FOLDER_LIMITS,
      portals: null,
      diagnostics: [],
    };
  }

  /** Roots from the config snapshot: explicit `skills.roots` win, `[]` disables the catalog. */
  private planFromConfig(config: Config, generation: string): IRootPlan {
    const systemRoot = config.system.root ?? ".";
    const diagnostics: ISkillDiagnostic[] = [];
    const place = (kind: SkillRootKind, path: string): IRootEntry | null => {
      const absolute = resolve(systemRoot, path);
      const within = relative(systemRoot, absolute);
      if (!isAbsolute(path) && (within.startsWith("..") || isAbsolute(within))) {
        diagnostics.push({
          name: null,
          root_kind: kind,
          safe_path: kind,
          reason: SkillDiagnosticReason.PATH_ESCAPE,
          severity: SkillDiagnosticSeverity.ERROR,
        });
        return null;
      }
      return { kind, path: absolute };
    };
    const configured = config.skills.roots ?? this.defaultRootConfig(config);
    const entries = configured.flatMap((entry) => {
      const placed = place(entry.kind, entry.path);
      return placed ? [placed] : [];
    });
    const skills = config.skills;
    return {
      generation,
      entries,
      limits: {
        mainMaxBytes: skills.main_max_bytes,
        sidecarMaxBytes: skills.sidecar_max_bytes,
        referenceMaxBytes: skills.reference_max_bytes,
        referenceMaxCount: skills.reference_max_count,
        referenceTotalMaxBytes: skills.reference_total_max_bytes,
        snapshotMaxBytes: skills.snapshot_max_bytes,
      },
      portals: new Set(config.portals.map((portal) => portal.alias)),
      diagnostics,
    };
  }

  /** Project and learned roots under the configured skills path, then the Blueprint catalog. */
  private defaultRootConfig(config: Config): Array<{ kind: SkillRootKind; path: string }> {
    const memorySkills = config.paths.memorySkills === ExaPathDefaults.memorySkills
      ? join(config.paths.memory, SKILLS_SUBDIR)
      : config.paths.memorySkills;
    return [
      { kind: SkillRootKind.PROJECT, path: join(memorySkills, PROJECT_SUBDIR) },
      { kind: SkillRootKind.LEARNED, path: join(memorySkills, LEARNED_SUBDIR) },
      { kind: SkillRootKind.BLUEPRINT, path: join(config.paths.blueprints, SKILLS_SUBDIR) },
    ];
  }

  /** Roots for one operation, highest precedence first. A project root needs a valid, configured portal. */
  private rootsFor(ctx: ISkillOperationContext): IResolvedSkillRoot[] {
    const plan = this.planFor(ctx);
    const roots: IResolvedSkillRoot[] = [];
    const overlay = Deno.env.get(EXA_EVAL_SKILL_OVERLAY_DIR_ENV_VAR);
    if (overlay) roots.push({ path: overlay, kind: SkillRootKind.EVAL_OVERLAY, writable: false, project: null });
    for (const entry of plan.entries) {
      if (entry.kind === SkillRootKind.PROJECT) {
        const portal = ctx.portal;
        if (portal === null) continue;
        if (!PORTAL_NAME_PATTERN.test(portal)) {
          throw new SkillMutationError(
            SkillMutationErrorCode.INVALID_INPUT,
            "invalid portal name for skill resolution",
          );
        }
        if (plan.portals !== null && !plan.portals.has(portal)) continue;
        roots.push({ path: join(entry.path, portal), kind: SkillRootKind.PROJECT, writable: true, project: portal });
      } else {
        roots.push({
          path: entry.path,
          kind: entry.kind,
          writable: entry.kind === SkillRootKind.LEARNED,
          project: null,
        });
      }
    }
    return roots;
  }

  /** The writable roots in precedence order: the portal's project root, then the learned root. */
  private writableRoots(ctx: ISkillOperationContext): IResolvedSkillRoot[] {
    return this.rootsFor(ctx).filter((root) => root.writable);
  }

  /** A loader for one operation's roots. `underLock` is for callers that already hold the root locks. */
  private loaderFor(ctx: ISkillOperationContext, underLock = false): SkillFolderLoader {
    const plan = this.planFor(ctx);
    const roots = this.rootsFor(ctx);
    const key = `${underLock ? "locked" : "open"}|${JSON.stringify(plan.limits)}|${
      roots.map((root) => `${root.kind}:${root.path}`).join("|")
    }`;
    const cached = this.loaders.get(key);
    if (cached) return cached;
    const loader = new SkillFolderLoader({
      roots,
      pathSecurity: createPathSecurity(),
      logger: this.loggerForLoaders,
      eventRegistry: this.registry,
      readLock: underLock ? undefined : (root, scan) => this.readUnderSharedLock(root, scan),
    }, plan.limits);
    this.loaders.set(key, loader);
    return loader;
  }

  private async readUnderSharedLock<T>(root: IResolvedSkillRoot, scan: () => Promise<T>): Promise<T> {
    if (!root.writable || !(await exists(join(root.path, STATE_DIR, LOCK_FILE)))) return await scan();
    return await this.publisher.withLocks([root.path], "shared", scan);
  }

  private async emit(type: TDomainEventType, ctx: ISkillOperationContext, payload: LogMetadata): Promise<void> {
    await this.registry.emit(SKILLS_SERVICE_SOURCE_ID, type, {
      request_id: ctx.requestId,
      flow_id: ctx.flowId,
      flow_step_id: ctx.flowStepId,
      agent_role: ctx.agentRole,
      config_generation: ctx.configGeneration,
      ...payload,
    }, ctx.traceId);
  }

  // Guarded mutations

  /** Journals skills.mutation_failed for every refused or failed mutation, then rethrows. */
  private async guarded<T>(
    name: string,
    operation: SkillMutationOperation,
    ctx: ISkillOperationContext,
    run: () => Promise<T>,
    missingIsNull = false,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (missingIsNull && error instanceof SkillMutationError && error.code === SkillMutationErrorCode.NOT_FOUND) {
        return null as T;
      }
      await this.emit(DomainEventType.SkillsMutationFailed, ctx, {
        name,
        operation,
        reason: error instanceof SkillMutationError ? error.code : SkillMutationErrorCode.PUBLICATION_UNAVAILABLE,
      });
      throw error;
    }
  }

  private parseInput<T>(
    schema: { safeParse(value: object): { success: true; data: T } | { success: false; error: { message: string } } },
    value: object,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new SkillMutationError(SkillMutationErrorCode.INVALID_INPUT, result.error.message);
    return result.data;
  }

  /** The root that mutations of a new skill target: the portal's project root, else the learned root. */
  private targetRoot(ctx: ISkillOperationContext): IResolvedSkillRoot {
    const target = this.writableRoots(ctx)[0];
    if (!target) throw new SkillMutationError(SkillMutationErrorCode.ROOT_UNAVAILABLE, "no writable skill root");
    return target;
  }

  private async publishDraft(
    skillDef: SkillDefinition,
    ctx: ISkillOperationContext,
    derivedFrom: Opt<string[], Reason.OptionalInput>,
  ): Promise<ILoadedSkill> {
    const input = this.parseInput(SkillAuthoringSchema, skillDef);
    const target = this.targetRoot(ctx);
    const writable = this.writableRoots(ctx);
    const allRoots = this.rootsFor(ctx);
    for (const root of writable) await this.publisher.ensureState(root.path);
    return await this.publisher.withLocks(writable.map((root) => root.path), "exclusive", async () => {
      for (const root of allRoots) {
        if (await this.hasEntry(root.path, input.name)) {
          throw new SkillMutationError(SkillMutationErrorCode.NAME_CONFLICT, `skill "${input.name}" already exists`);
        }
      }
      const snapshot = composeNewSnapshot(input, derivedFrom);
      await this.validateSnapshot(snapshot, target, input.name);
      await this.publisher.create(target.path, input.name, snapshot);
      return await this.requireLoaded(input.name, ctx);
    });
  }

  private async hasEntry(rootPath: string, name: string): Promise<boolean> {
    try {
      await Deno.lstat(join(rootPath, name));
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }

  /** Runs `run` under exclusive locks with the skill's current value and the writable root that owns it. */
  private async withWritableOwner<T>(
    name: string,
    ctx: ISkillOperationContext,
    run: (current: ILoadedSkill, root: IResolvedSkillRoot) => Promise<T>,
  ): Promise<T | null> {
    const writable = this.writableRoots(ctx);
    for (const root of writable) await this.publisher.ensureState(root.path);
    return await this.publisher.withLocks(writable.map((root) => root.path), "exclusive", async () => {
      const current = await this.loaderFor(ctx, true).getAny(name, ctx);
      if (current === null) return null;
      const root = writable.find((candidate) => candidate.kind === current.rootKind);
      if (!root) {
        throw new SkillMutationError(SkillMutationErrorCode.ROOT_UNAVAILABLE, `skill "${name}" is in a read-only root`);
      }
      return await run(current, root);
    });
  }

  private async replaceFolder(
    root: IResolvedSkillRoot,
    current: ILoadedSkill,
    snapshot: ISkillRevisionSnapshot,
    ctx: ISkillOperationContext,
  ): Promise<ILoadedSkill> {
    await this.validateSnapshot(snapshot, root, current.skill.name);
    await this.publisher.replace(root.path, current.skill.name, snapshot);
    return await this.requireLoaded(current.skill.name, ctx);
  }

  private async requireLoaded(name: string, ctx: ISkillOperationContext): Promise<ILoadedSkill> {
    const loaded = await this.loaderFor(ctx, true).getAny(name, ctx);
    if (loaded === null) {
      throw new SkillMutationError(
        SkillMutationErrorCode.PUBLICATION_UNAVAILABLE,
        `published skill "${name}" did not load`,
      );
    }
    return loaded;
  }

  /** Parses the staged snapshot exactly as the loader would, so an invalid folder is never published. */
  private async validateSnapshot(
    snapshot: ISkillRevisionSnapshot,
    root: IResolvedSkillRoot,
    name: string,
  ): Promise<void> {
    try {
      await parseSkillSnapshot(snapshot, buildRootContext(root, name));
    } catch (error) {
      throw new SkillMutationError(
        SkillMutationErrorCode.INVALID_INPUT,
        error instanceof Error ? error.message : "invalid skill content",
      );
    }
  }

  /** Recomposes one SKILL.md body and sidecar from the current folder plus the authored update. */
  private composeUpdate(
    current: ILoadedSkill,
    updates: ReturnType<typeof SkillAuthoringUpdateSchema.parse>,
  ): ISkillRevisionSnapshot {
    const { frontmatter, body: currentBody } = splitSnapshot(current.snapshot.skill_md);
    const instructions = updates.instructions ?? currentBody;
    const examples = "examples" in updates ? updates.examples : splitInstructionsAndExamples(currentBody).examples;
    const body = assembleBody(instructions, examples, updates.instructions !== undefined || "examples" in updates);
    const nextFrontmatter = { ...frontmatter, ...(updates.description ? { description: updates.description } : {}) };
    const sidecar = mergeSidecar(readSidecar(current.snapshot.exaix_yaml), updates);
    return {
      skill_md: composeSkillMd(nextFrontmatter, body),
      exaix_yaml: encodeSidecar(sidecar),
      references: current.snapshot.references,
    };
  }
}

// Pure composition helpers

function splitSnapshot(skillMd: string): { frontmatter: Record<string, string | string[]>; body: string } {
  const canonical = canonicalizeSkillText(skillMd);
  const end = canonical.indexOf("\n---\n", 4);
  const frontmatter = SkillFrontmatterSchema.partial().parse(parseYaml(canonical.slice(4, end))) as Record<
    string,
    string | string[]
  >;
  return { frontmatter, body: canonical.slice(end + 5).trim() };
}

function composeSkillMd(frontmatter: Record<string, string | string[]>, body: string): string {
  return `---\n${stringifyYaml(frontmatter, { lineWidth: 120 }).trimEnd()}\n---\n${body}\n`;
}

/** One body from instructions plus examples, so an update never leaves a stale Examples section. */
function assembleBody(
  instructions: string,
  examples: Opt<string, Reason.OptionalInput>,
  examplesAuthored: boolean,
): string {
  if (!examplesAuthored) return instructions;
  const base = stripExamplesSection(instructions).trimEnd();
  return examples === undefined || examples === "" ? base : `${base}\n\n${SKILL_EXAMPLES_HEADING}\n\n${examples}`;
}

function readSidecar(raw: string | null): ISkillSidecar {
  return raw === null ? {} : (parseYaml(canonicalizeSkillText(raw)) as ISkillSidecar) ?? {};
}

function encodeSidecar(sidecar: ISkillSidecar): string | null {
  return Object.keys(sidecar).length === 0 ? null : stringifyYaml(sidecar, { lineWidth: 120 });
}

/** The sidecar fields a person authors. Lifecycle status and learning provenance are managed, never authored. */
const AuthoredSidecarFieldsSchema = z.object(
  SkillSidecarSchema.pick({
    title: true,
    triggers: true,
    constraints: true,
    output_requirements: true,
    quality_criteria: true,
    critical: true,
    effort: true,
    thinking: true,
    tools: true,
    applies_to: true,
    related_skills: true,
  }).shape,
);

/** The base sidecar with the authored fields of `updates` laid over it. Other input keys are ignored. */
function mergeSidecar(base: ISkillSidecar, updates: Partial<ISkillAuthoring>): ISkillSidecar {
  const authored = AuthoredSidecarFieldsSchema.parse(updates);
  const merged: ISkillSidecar = { ...base };
  for (const key of Object.keys(authored) as Array<keyof typeof authored>) {
    const value = authored[key];
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

function composeNewSnapshot(
  input: ISkillAuthoring,
  derivedFrom: Opt<string[], Reason.OptionalInput>,
): ISkillRevisionSnapshot {
  const body = assembleBody(input.instructions, input.examples, input.examples !== undefined);
  const sidecar = mergeSidecar({ status: SkillStatus.DRAFT }, input);
  if (derivedFrom !== undefined) sidecar.derived_from = derivedFrom;
  return {
    skill_md: composeSkillMd({ name: input.name, description: input.description }, body),
    exaix_yaml: encodeSidecar(sidecar),
    references: [],
  };
}

/** The snapshot with its sidecar status set. Status lives only in the sidecar. */
function withStatus(snapshot: ISkillRevisionSnapshot, status: SkillStatus): ISkillRevisionSnapshot {
  const sidecar = readSidecar(snapshot.exaix_yaml);
  return { ...snapshot, exaix_yaml: encodeSidecar({ ...sidecar, status }) };
}
