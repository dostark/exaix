/**
 * @module SkillUsageStore
 * @path packages/core/src/skills/skill_usage_store.ts
 * @description Durable per-submission skill usage. One model submission writes its complete skill
 *   vector as a single multi-row INSERT OR IGNORE statement, so the vector persists completely or
 *   not at all. A failed write emits skills.audit_failed and throws skill_audit_unavailable. Reads
 *   give per-name and per-revision totals and a per-trace join to the canonical snapshots.
 * @architectural-layer Core
 * @dependencies [./skill_types.ts, ../events, ../types/i_database_service.ts]
 * @related-files [packages/core/src/skills/skill_revision_store.ts]
 * @visible
 */

import { DomainEventType } from "../events/domain_event_types.ts";
import type { IEventRegistry } from "../events/event_registry.ts";
import {
  SkillAuditStage,
  type SkillMatchSource,
  type SkillRenderOutcome,
  type SkillRootKind,
  type SkillSubmissionKind,
} from "../types/enums.ts";
import type { IDatabaseService } from "../types/i_database_service.ts";
import {
  type ISkillOperationContext,
  type ISkillRevisionSnapshot,
  type ISkillStoreDeps,
  type ISkillSubmission,
  type ISkillUsageRecord,
  type ISkillUsageSummary,
  SkillAuditUnavailableError,
} from "./skill_types.ts";

/** Event source id registered by the store. */
export const SKILL_USAGE_STORE_SOURCE_ID = "skill-usage-store";

/** Insert column list, in the order the parameters of one row are bound. */
const USAGE_COLUMN_LIST =
  "call_id, revision_id, skill_name, trace_id, request_id, flow_id, flow_step_id, agent_role, " +
  "match_source, render_mode, submission_kind, round, attempt, root_kind, source_path, config_generation, used_at";
const ROW_PLACEHOLDERS = `(${USAGE_COLUMN_LIST.split(",").map(() => "?").join(", ")})`;

interface IUsageRow {
  call_id: string;
  revision_id: string;
  skill_name: string;
  trace_id: string;
  request_id: string | null;
  flow_id: string | null;
  flow_step_id: string | null;
  agent_role: string;
  match_source: SkillMatchSource;
  render_mode: SkillRenderOutcome;
  submission_kind: SkillSubmissionKind;
  round: number;
  attempt: number;
  root_kind: SkillRootKind;
  source_path: string;
  config_generation: string;
  used_at: string;
  skill_md: string;
  exaix_yaml: string | null;
  references: string;
}

interface ISummaryRow {
  revision_id: string;
  use_count: number;
  last_used_at: string;
  first_seen_at: string;
  root_kind: SkillRootKind;
  source_path: string;
}

export class SkillUsageStore {
  private readonly db: IDatabaseService;
  private readonly registry: IEventRegistry;

  constructor(deps: ISkillStoreDeps) {
    this.db = deps.db;
    this.registry = deps.eventRegistry;
    this.registry.registerPublisher(SKILL_USAGE_STORE_SOURCE_ID, [
      DomainEventType.SkillsUsageRecorded,
      DomainEventType.SkillsAuditFailed,
    ]);
  }

  /** Writes the full vector in one statement. Every revision row must already be durable. */
  async record(submission: ISkillSubmission, ctx: ISkillOperationContext): Promise<void> {
    if (submission.items.length === 0) return;
    const usedAt = new Date().toISOString();
    const params = submission.items.flatMap((item) => [
      submission.callId,
      item.revisionId,
      item.skillName,
      ctx.traceId,
      ctx.requestId,
      ctx.flowId,
      ctx.flowStepId,
      ctx.agentRole,
      item.matchSource,
      item.renderMode,
      submission.submissionKind,
      submission.round,
      submission.attempt,
      item.rootKind,
      item.sourcePath,
      ctx.configGeneration,
      usedAt,
    ]);
    try {
      await this.db.preparedRun(
        `INSERT OR IGNORE INTO skill_usage (${USAGE_COLUMN_LIST}) VALUES ${
          submission.items.map(() => ROW_PLACEHOLDERS).join(", ")
        }`,
        params,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.registry.emit(
        SKILL_USAGE_STORE_SOURCE_ID,
        DomainEventType.SkillsAuditFailed,
        { ...identity(ctx), stage: SkillAuditStage.USAGE, call_id: submission.callId, reason },
        ctx.traceId,
      );
      throw new SkillAuditUnavailableError(`Skill usage could not be recorded: ${reason}`);
    }
    await this.registry.emit(
      SKILL_USAGE_STORE_SOURCE_ID,
      DomainEventType.SkillsUsageRecorded,
      {
        ...identity(ctx),
        call_id: submission.callId,
        submission_kind: submission.submissionKind,
        round: submission.round,
        attempt: submission.attempt,
        revisions: submission.items.map((item) => item.revisionId),
        count: submission.items.length,
      },
      ctx.traceId,
    );
  }

  /** Totals for one skill name, with a per-revision breakdown. */
  async summary(name: string, _ctx: ISkillOperationContext): Promise<ISkillUsageSummary> {
    const rows = await this.db.preparedAll<ISummaryRow>(
      `SELECT u.revision_id AS revision_id, COUNT(*) AS use_count, MAX(u.used_at) AS last_used_at,
              r.first_seen_at AS first_seen_at,
              (SELECT u2.root_kind FROM skill_usage u2 WHERE u2.revision_id = u.revision_id
                ORDER BY u2.id DESC LIMIT 1) AS root_kind,
              (SELECT u2.source_path FROM skill_usage u2 WHERE u2.revision_id = u.revision_id
                ORDER BY u2.id DESC LIMIT 1) AS source_path
         FROM skill_usage u JOIN skill_revisions r ON r.revision_id = u.revision_id
        WHERE u.skill_name = ?
        GROUP BY u.revision_id
        ORDER BY r.first_seen_at ASC, r.rowid ASC`,
      [name],
    );
    const lastUsedAt = rows.reduce<string | null>(
      (latest, row) => latest === null || row.last_used_at > latest ? row.last_used_at : latest,
      null,
    );
    return {
      name,
      totalUses: rows.reduce((sum, row) => sum + row.use_count, 0),
      lastUsedAt,
      revisions: rows.map((row) => ({
        revisionId: row.revision_id,
        useCount: row.use_count,
        lastUsedAt: row.last_used_at,
        firstSeenAt: row.first_seen_at,
        rootKind: row.root_kind,
        sourcePath: row.source_path,
      })),
    };
  }

  /** Every use on one trace, joined to the canonical snapshot of the revision it used. */
  async byTrace(traceId: string, _ctx: ISkillOperationContext): Promise<ISkillUsageRecord[]> {
    const rows = await this.db.preparedAll<IUsageRow>(
      `SELECT u.call_id, u.revision_id, u.skill_name, u.trace_id, u.request_id, u.flow_id, u.flow_step_id,
              u.agent_role, u.match_source, u.render_mode, u.submission_kind, u.round, u.attempt, u.root_kind,
              u.source_path, u.config_generation, u.used_at, r.skill_md, r.exaix_yaml,
              r."references" AS "references"
         FROM skill_usage u JOIN skill_revisions r ON r.revision_id = u.revision_id
        WHERE u.trace_id = ?
        ORDER BY u.id ASC`,
      [traceId],
    );
    return rows.map((row) => ({
      callId: row.call_id,
      revisionId: row.revision_id,
      skillName: row.skill_name,
      traceId: row.trace_id,
      requestId: row.request_id,
      flowId: row.flow_id,
      flowStepId: row.flow_step_id,
      agentRole: row.agent_role,
      matchSource: row.match_source,
      renderMode: row.render_mode,
      submissionKind: row.submission_kind,
      round: row.round,
      attempt: row.attempt,
      rootKind: row.root_kind,
      sourcePath: row.source_path,
      configGeneration: row.config_generation,
      usedAt: row.used_at,
      snapshot: snapshotOf(row),
    }));
  }
}

function snapshotOf(row: IUsageRow): ISkillRevisionSnapshot {
  return {
    skill_md: row.skill_md,
    exaix_yaml: row.exaix_yaml,
    references: JSON.parse(row.references) as ISkillRevisionSnapshot["references"],
  };
}

function identity(ctx: ISkillOperationContext) {
  return {
    request_id: ctx.requestId,
    flow_id: ctx.flowId,
    flow_step_id: ctx.flowStepId,
    agent_role: ctx.agentRole,
    config_generation: ctx.configGeneration,
  };
}
