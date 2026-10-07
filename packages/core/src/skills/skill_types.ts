/**
 * @module SkillTypes
 * @path packages/core/src/skills/skill_types.ts
 * @description Shared types for the folder-based skill subsystem: the immutable
 *   revision snapshot, its per-resolution provenance, operation scope, plan pins,
 *   store dependency contracts and the typed required-skill failure.
 * @architectural-layer Core
 * @dependencies [@exaix/schemas, ./enums]
 * @related-files [packages/core/src/skills/skill_snapshot.ts]
 */

import type { IRuntimeSkill } from "@exaix/schemas/runtime_skill.ts";
import type { ISkillPinRecord } from "@exaix/schemas/skill_pin.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";
import type { IEventLogger } from "../logger/mod.ts";
import type { IEventRegistry } from "../events/event_registry.ts";
import type { IDatabaseService } from "../types/i_database_service.ts";
import type { IPathSecurityOps } from "@exaix/tool-runtime";
import type {
  MemoryBankSource,
  MemoryScope,
  SkillDiagnosticReason,
  SkillDiagnosticSeverity,
  SkillMatchSource,
  SkillMutationErrorCode,
  SkillRenderOutcome,
  SkillRootKind,
  SkillSubmissionKind,
} from "../types/enums.ts";

/** Permissive container for YAML frontmatter/sidecar values, validated by schema before use. */
export interface ISkillYamlMap {
  [key: string]: string | number | boolean | null | ISkillYamlMap | Array<string | ISkillYamlMap>;
}

/** One canonical, content-addressed skill revision. Absence of the sidecar is a
 *  distinct null sentinel from an empty file. */
export interface ISkillRevisionSnapshot {
  skill_md: string;
  exaix_yaml: string | null;
  references: ReadonlyArray<{ path: string; content: string }>;
}

/** The root/context a snapshot is parsed under. Root kind and scope are root
 *  policy, never stored on the content-addressed revision row. */
export interface ISkillRootContext {
  rootKind: SkillRootKind;
  name: string;
  path: string;
  project: string | null;
  source: MemoryBankSource;
  scope: MemoryScope;
}

/** A parsed snapshot coupled to its runtime view and per-resolution provenance. */
export interface ILoadedSkill {
  skill: IRuntimeSkill;
  revisionId: string;
  contentSha256: string;
  rootKind: SkillRootKind;
  sourcePath: string;
  snapshot: ISkillRevisionSnapshot;
}

/** Immutable per-operation scope shared by every read/mutation in one resolution. */
export interface ISkillOperationContext {
  portal: string | null;
  traceId: string;
  requestId: string | null;
  flowId: string | null;
  flowStepId: string | null;
  agentRole: string;
  configGeneration: string;
}

/** A durable plan pin. Provenance lives on the pin, not the revision row. */
export type ISkillPin = ISkillPinRecord;

/** A pin joined to the immutable snapshot it names. */
export interface IPinnedSkill {
  pin: ISkillPin;
  loaded: ILoadedSkill;
}

/** One skill included in one model submission. */
export interface ISkillSubmissionItem {
  skillName: string;
  revisionId: string;
  matchSource: SkillMatchSource;
  renderMode: SkillRenderOutcome;
  rootKind: SkillRootKind;
  sourcePath: string;
}

/** One observable model submission and the complete vector of skills it carried. */
export interface ISkillSubmission {
  callId: string;
  submissionKind: SkillSubmissionKind;
  round: number;
  attempt: number;
  items: readonly ISkillSubmissionItem[];
}

/** One stored usage row, joined to the canonical snapshot of its revision. */
export interface ISkillUsageRecord {
  callId: string;
  revisionId: string;
  skillName: string;
  traceId: string;
  requestId: string | null;
  flowId: string | null;
  flowStepId: string | null;
  agentRole: string;
  matchSource: SkillMatchSource;
  renderMode: SkillRenderOutcome;
  submissionKind: SkillSubmissionKind;
  round: number;
  attempt: number;
  rootKind: SkillRootKind;
  sourcePath: string;
  configGeneration: string;
  usedAt: string;
  snapshot: ISkillRevisionSnapshot;
}

/** Usage totals for one skill, with a per-revision breakdown. */
export interface ISkillUsageSummary {
  name: string;
  totalUses: number;
  lastUsedAt: string | null;
  revisions: Array<{
    revisionId: string;
    useCount: number;
    lastUsedAt: string;
    firstSeenAt: string;
    /** Root and folder of the most recent use, the revision's origin. */
    rootKind: SkillRootKind;
    sourcePath: string;
  }>;
}

/** One admitted skill root, ordered by precedence. */
export interface IResolvedSkillRoot {
  path: string;
  kind: SkillRootKind;
  writable: boolean;
  project: string | null;
}

/** A non-fatal discovery/validation outcome for one candidate folder. */
export interface ISkillDiagnostic {
  name: string | null;
  root_kind: SkillRootKind;
  safe_path: string;
  reason: SkillDiagnosticReason;
  severity: SkillDiagnosticSeverity;
}

/** Dependencies of the skill folder loader. Roots are already resolved and admitted. */
export interface ISkillFolderLoaderDeps {
  roots: readonly IResolvedSkillRoot[];
  pathSecurity: IPathSecurityOps;
  logger: IEventLogger;
  eventRegistry: IEventRegistry;
  /** Wraps one root's scan, so writable roots can be read under a shared lock. */
  readLock?: <T>(root: IResolvedSkillRoot, scan: () => Promise<T>) => Promise<T>;
}

/** Per-file and aggregate byte caps applied before any parse, hash or store. */
export interface ISkillFolderLimits {
  mainMaxBytes: number;
  sidecarMaxBytes: number;
  referenceMaxBytes: number;
  referenceMaxChars: number;
  referenceMaxCount: number;
  referenceTotalMaxBytes: number;
  snapshotMaxBytes: number;
  fallbackMinWordChars: number;
  fallbackMaxKeywords: number;
}

/** Limits of the keyword fallback, taken from the validated config. */
export interface ISkillFallbackLimits {
  minWordChars: number;
  maxKeywords: number;
}

/** Linked reference files of a body and the targets under `references/` that the grammar does not support. */
export interface ISkillReferenceLinks {
  linked: string[];
  unsupported: string[];
}

export interface ISkillStoreDeps {
  db: IDatabaseService;
  logger: IEventLogger;
  eventRegistry: IEventRegistry;
}

/** A stored, verified revision row. */
export interface ISkillRevisionRecord {
  revisionId: string;
  contentSha256: string;
  skillName: string;
  snapshot: ISkillRevisionSnapshot;
  firstSeenAt: string;
}

/** Fail-closed error for a required skill that could not be loaded. */
export class SkillUnavailableError extends Error {
  readonly code = "skill_unavailable";
  constructor(readonly skillName: string, message: Opt<string, Reason.OptionalContext> = undefined) {
    super(message ?? `Required skill "${skillName}" is unavailable`);
    this.name = "SkillUnavailableError";
  }
}

/** Fail-closed error when a skill snapshot or usage write cannot be made durable. */
export class SkillAuditUnavailableError extends Error {
  readonly code = "skill_audit_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "SkillAuditUnavailableError";
  }
}

/** A refused or failed skill mutation, carrying its machine-readable code. */
export class SkillMutationError extends Error {
  constructor(readonly code: SkillMutationErrorCode, message: string) {
    super(message);
    this.name = "SkillMutationError";
  }
}
