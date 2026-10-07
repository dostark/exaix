/**
 * @module SkillRevisionStore
 * @path packages/core/src/skills/skill_revision_store.ts
 * @description Durable, content-addressed storage of skill revisions in the journal DB.
 *   A revision is inserted once, the first time it is injected or pinned, and every
 *   historical read recomputes its digest, UUID and name so corrupt rows fail closed.
 *   A write failure emits skills.audit_failed and throws skill_audit_unavailable.
 * @architectural-layer Core
 * @dependencies [./skill_snapshot.ts, ./skill_types.ts, ../events, ../types/i_database_service.ts]
 * @related-files [packages/core/src/skills/skill_folder_loader.ts]
 * @visible
 */

import { DomainEventType } from "../events/domain_event_types.ts";
import type { IEventRegistry } from "../events/event_registry.ts";
import { SkillAuditStage } from "../types/enums.ts";
import type { IDatabaseService } from "../types/i_database_service.ts";
import { canonicalizeSkillText, computeRevisionId, computeSkillContentSha256 } from "./skill_snapshot.ts";
import {
  type ILoadedSkill,
  type ISkillOperationContext,
  type ISkillRevisionRecord,
  type ISkillStoreDeps,
  SkillAuditUnavailableError,
} from "./skill_types.ts";

/** Event source id registered by the store. */
export const SKILL_REVISION_STORE_SOURCE_ID = "skill-revision-store";

interface ISkillRevisionRow {
  revision_id: string;
  content_sha256: string;
  skill_name: string;
  skill_md: string;
  exaix_yaml: string | null;
  references: string;
  first_seen_at: string;
}

const SELECT_COLUMNS =
  'r.revision_id, r.content_sha256, r.skill_name, r.skill_md, r.exaix_yaml, r."references" AS "references", r.first_seen_at';

/** Scope value of a global skill. A project skill is scoped by its portal alias. */
const GLOBAL_SCOPE = "";

/** A read sees a revision only when it was recorded in a global scope or in the reader's own portal. */
const VISIBLE_TO_SCOPE =
  "EXISTS (SELECT 1 FROM skill_revision_scopes s WHERE s.revision_id = r.revision_id AND s.project IN (?, ?))";

function scopeOf(ctx: ISkillOperationContext): string {
  return ctx.portal ?? GLOBAL_SCOPE;
}

export class SkillRevisionStore {
  private readonly db: IDatabaseService;
  private readonly registry: IEventRegistry;

  constructor(deps: ISkillStoreDeps) {
    this.db = deps.db;
    this.registry = deps.eventRegistry;
    this.registry.registerPublisher(SKILL_REVISION_STORE_SOURCE_ID, [
      DomainEventType.SkillsRevisionRecorded,
      DomainEventType.SkillsAuditFailed,
    ]);
  }

  /** Inserts the revision when absent. Returns true only for the call that inserted it. */
  async record(loaded: ILoadedSkill, ctx: ISkillOperationContext): Promise<boolean> {
    let inserted: boolean;
    try {
      const result = await this.db.preparedRun(
        `INSERT OR IGNORE INTO skill_revisions
           (revision_id, content_sha256, skill_name, skill_md, exaix_yaml, "references", first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          loaded.revisionId,
          loaded.contentSha256,
          loaded.skill.name,
          canonicalizeSkillText(loaded.snapshot.skill_md),
          loaded.snapshot.exaix_yaml === null ? null : canonicalizeSkillText(loaded.snapshot.exaix_yaml),
          JSON.stringify(
            loaded.snapshot.references.map((r) => ({ path: r.path, content: canonicalizeSkillText(r.content) })),
          ),
          new Date().toISOString(),
        ],
      );
      await this.db.preparedRun(
        "INSERT OR IGNORE INTO skill_revision_scopes (revision_id, project) VALUES (?, ?)",
        [loaded.revisionId, loaded.skill.project ?? GLOBAL_SCOPE],
      );
      inserted = typeof result === "number" && result > 0;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.registry.emit(
        SKILL_REVISION_STORE_SOURCE_ID,
        DomainEventType.SkillsAuditFailed,
        { ...identity(ctx), stage: SkillAuditStage.REVISION, call_id: null, reason },
        ctx.traceId,
      );
      throw new SkillAuditUnavailableError(`Skill revision snapshot could not be recorded: ${reason}`);
    }
    if (inserted) {
      await this.registry.emit(
        SKILL_REVISION_STORE_SOURCE_ID,
        DomainEventType.SkillsRevisionRecorded,
        {
          ...identity(ctx),
          name: loaded.skill.name,
          revision_id: loaded.revisionId,
          content_sha256: loaded.contentSha256,
        },
        ctx.traceId,
      );
    }
    return inserted;
  }

  /** Returns the verified revision, or null when it was never recorded or is outside the reader's scope. */
  async get(revisionId: string, ctx: ISkillOperationContext): Promise<ISkillRevisionRecord | null> {
    const row = await this.db.preparedGet<ISkillRevisionRow>(
      `SELECT ${SELECT_COLUMNS} FROM skill_revisions r WHERE r.revision_id = ? AND ${VISIBLE_TO_SCOPE}`,
      [revisionId, GLOBAL_SCOPE, scopeOf(ctx)],
    );
    return row ? await verifyRow(row) : null;
  }

  /** All revisions of one skill that the reader's scope can see, oldest first. */
  async listByName(name: string, ctx: ISkillOperationContext): Promise<ISkillRevisionRecord[]> {
    const rows = await this.db.preparedAll<ISkillRevisionRow>(
      `SELECT ${SELECT_COLUMNS} FROM skill_revisions r WHERE r.skill_name = ? AND ${VISIBLE_TO_SCOPE}
         ORDER BY r.first_seen_at ASC, r.rowid ASC`,
      [name, GLOBAL_SCOPE, scopeOf(ctx)],
    );
    return await Promise.all(rows.map(verifyRow));
  }
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

async function verifyRow(row: ISkillRevisionRow): Promise<ISkillRevisionRecord> {
  const snapshot = {
    skill_md: row.skill_md,
    exaix_yaml: row.exaix_yaml,
    references: JSON.parse(row.references) as Array<{ path: string; content: string }>,
  };
  const digest = await computeSkillContentSha256(snapshot).catch(() => "");
  const revisionId = digest === "" ? "" : await computeRevisionId(digest);
  if (digest !== row.content_sha256 || revisionId !== row.revision_id) {
    throw new Error(`Skill revision ${row.revision_id} is corrupt: stored content does not match its digest`);
  }
  return {
    revisionId: row.revision_id,
    contentSha256: row.content_sha256,
    skillName: row.skill_name,
    snapshot,
    firstSeenAt: row.first_seen_at,
  };
}
