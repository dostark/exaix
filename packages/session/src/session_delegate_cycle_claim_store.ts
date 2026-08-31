/**
 * @module SessionDelegateCycleClaimStore
 * @path packages/session/src/session_delegate_cycle_claim_store.ts
 * @description Phase 174 Step 4 SQLite-backed launch source of truth for
 *   session_delegate_cycle steps. A unique key on (parentTraceId, parentStepId,
 *   sequence, planDigest) guarantees at most one durable launch per plan-step
 *   idempotency tuple across crash points and duplicate handler/watcher entry.
 *   Built on the generic IDatabaseService prepared-statement surface (no direct
 *   @db/sqlite dependency), against the `session_delegate_cycle_claims` table
 *   declared in migrations/001_init.sql.
 * @architectural-layer Services
 * @dependencies [@exaix/core/types]
 * @related-files [packages/session/src/session_delegate_cycle_store.ts, apps/daemon/src/recovery.ts]
 */

import { z } from "zod";
import type { IDatabaseService, Opt, Reason, SqliteParam } from "@exaix/core/types";
import { type ISessionDelegationOutcome, SessionDelegationOutcomeSchema } from "./session_delegation.ts";

export interface ISessionDelegateCycleClaimKey {
  parentTraceId: string;
  parentStepId: string;
  sequence: number;
  planDigest: string;
}

export interface ISessionDelegateCycleClaim extends ISessionDelegateCycleClaimKey {
  delegationTraceId: string;
  state: ISessionDelegateCycleClaimState;
  outcome?: ISessionDelegationOutcome;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type ISessionDelegateCycleClaimAcquireResult =
  | { outcome: typeof SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired; claim: ISessionDelegateCycleClaim }
  | { outcome: typeof SessionDelegateCycleClaimAcquireOutcomeSchema.enum.existing; claim: ISessionDelegateCycleClaim };

export interface ISessionDelegateCycleClaimTransitionInput {
  outcome?: ISessionDelegationOutcome;
  failureReason?: string;
}

export interface ISessionDelegateCycleClaimStore {
  /** Inserts a fresh claim in the initial lifecycle state. A conflicting existing row is returned, never overwritten. */
  acquire(
    key: ISessionDelegateCycleClaimKey,
    delegationTraceId: string,
  ): Promise<ISessionDelegateCycleClaimAcquireResult>;
  /** Re-stamps a pre-launch row (no launch was ever recorded) with a fresh delegation trace. A no-op once the row has moved on — that launch owns the tuple. */
  reclaimPreLaunch(
    key: ISessionDelegateCycleClaimKey,
    delegationTraceId: string,
  ): Promise<ISessionDelegateCycleClaimAcquireResult>;
  transition(
    key: ISessionDelegateCycleClaimKey,
    state: ISessionDelegateCycleClaimState,
    input?: Opt<ISessionDelegateCycleClaimTransitionInput, Reason.OptionalInput>,
  ): Promise<void>;
  get(key: ISessionDelegateCycleClaimKey): Promise<ISessionDelegateCycleClaim | null>;
  getByDelegationTraceId(delegationTraceId: string): Promise<ISessionDelegateCycleClaim | null>;
}

/** The claim lifecycle vocabulary: minted-and-parked, spawned, outcome recorded, review passed, or terminally failed. */
export const SessionDelegateCycleClaimStateSchema = z.enum(["claimed", "launched", "returned", "reviewed", "failed"]);
export type ISessionDelegateCycleClaimState = z.infer<typeof SessionDelegateCycleClaimStateSchema>;

export const SessionDelegateCycleClaimAcquireOutcomeSchema = z.enum(["acquired", "existing"]);

interface ISessionDelegateCycleClaimRow {
  parent_trace_id: string;
  parent_step_id: string;
  sequence: number;
  plan_digest: string;
  delegation_trace_id: string;
  state: ISessionDelegateCycleClaimState;
  outcome_json: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

const UNIQUE_CONSTRAINT_MARKER = "UNIQUE constraint failed";

function rowToClaim(row: ISessionDelegateCycleClaimRow): ISessionDelegateCycleClaim {
  return {
    parentTraceId: row.parent_trace_id,
    parentStepId: row.parent_step_id,
    sequence: row.sequence,
    planDigest: row.plan_digest,
    delegationTraceId: row.delegation_trace_id,
    state: row.state,
    outcome: row.outcome_json ? SessionDelegationOutcomeSchema.parse(JSON.parse(row.outcome_json)) : undefined,
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function keyParams(key: ISessionDelegateCycleClaimKey): SqliteParam[] {
  return [key.parentTraceId, key.parentStepId, key.sequence, key.planDigest];
}

export class SessionDelegateCycleClaimStore implements ISessionDelegateCycleClaimStore {
  constructor(
    private readonly db: IDatabaseService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acquire(
    key: ISessionDelegateCycleClaimKey,
    delegationTraceId: string,
  ): Promise<ISessionDelegateCycleClaimAcquireResult> {
    const timestamp = this.now().toISOString();
    try {
      await this.db.preparedRun(
        `INSERT INTO session_delegate_cycle_claims (
          parent_trace_id, parent_step_id, sequence, plan_digest,
          delegation_trace_id, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [...keyParams(key), delegationTraceId, SessionDelegateCycleClaimStateSchema.enum.claimed, timestamp, timestamp],
      );
      const claim = await this.get(key);
      if (!claim) throw new Error("session_delegate_cycle_claims insert did not persist");
      return { outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired, claim };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes(UNIQUE_CONSTRAINT_MARKER)) throw error;
      const existing = await this.get(key);
      if (!existing) throw error;
      return { outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.existing, claim: existing };
    }
  }

  async reclaimPreLaunch(
    key: ISessionDelegateCycleClaimKey,
    delegationTraceId: string,
  ): Promise<ISessionDelegateCycleClaimAcquireResult> {
    const timestamp = this.now().toISOString();
    await this.db.preparedRun(
      `UPDATE session_delegate_cycle_claims
       SET delegation_trace_id = ?, updated_at = ?
       WHERE parent_trace_id = ? AND parent_step_id = ? AND sequence = ? AND plan_digest = ? AND state = ?`,
      [delegationTraceId, timestamp, ...keyParams(key), SessionDelegateCycleClaimStateSchema.enum.claimed],
    );
    const claim = await this.get(key);
    if (!claim) throw new Error("session_delegate_cycle_claims reclaim target vanished");
    return claim.delegationTraceId === delegationTraceId
      ? { outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired, claim }
      : { outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.existing, claim };
  }

  async transition(
    key: ISessionDelegateCycleClaimKey,
    state: ISessionDelegateCycleClaimState,
    input?: Opt<ISessionDelegateCycleClaimTransitionInput, Reason.OptionalInput>,
  ): Promise<void> {
    const timestamp = this.now().toISOString();
    const outcomeJson = input?.outcome ? JSON.stringify(SessionDelegationOutcomeSchema.parse(input.outcome)) : null;
    await this.db.preparedRun(
      `UPDATE session_delegate_cycle_claims
       SET state = ?, outcome_json = COALESCE(?, outcome_json), failure_reason = ?, updated_at = ?
       WHERE parent_trace_id = ? AND parent_step_id = ? AND sequence = ? AND plan_digest = ?`,
      [state, outcomeJson, input?.failureReason ?? null, timestamp, ...keyParams(key)],
    );
  }

  async get(key: ISessionDelegateCycleClaimKey): Promise<ISessionDelegateCycleClaim | null> {
    const row = await this.db.preparedGet<ISessionDelegateCycleClaimRow>(
      `SELECT * FROM session_delegate_cycle_claims
       WHERE parent_trace_id = ? AND parent_step_id = ? AND sequence = ? AND plan_digest = ?`,
      keyParams(key),
    );
    return row ? rowToClaim(row) : null;
  }

  async getByDelegationTraceId(delegationTraceId: string): Promise<ISessionDelegateCycleClaim | null> {
    const row = await this.db.preparedGet<ISessionDelegateCycleClaimRow>(
      `SELECT * FROM session_delegate_cycle_claims WHERE delegation_trace_id = ?`,
      [delegationTraceId],
    );
    return row ? rowToClaim(row) : null;
  }
}

function claimKeyString(key: ISessionDelegateCycleClaimKey): string {
  return `${key.parentTraceId} ${key.parentStepId} ${key.sequence} ${key.planDigest}`;
}

/** Correct within one process but not crash-durable — production wiring
 *  (apps/daemon/main.ts) supplies SessionDelegateCycleClaimStore instead. */
export function createInMemorySessionDelegateCycleClaimStore(): ISessionDelegateCycleClaimStore {
  const claims = new Map<string, ISessionDelegateCycleClaim>();
  return {
    acquire(
      key: ISessionDelegateCycleClaimKey,
      delegationTraceId: string,
    ): Promise<ISessionDelegateCycleClaimAcquireResult> {
      const existing = claims.get(claimKeyString(key));
      if (existing) {
        return Promise.resolve({
          outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.existing,
          claim: existing,
        });
      }
      const timestamp = new Date().toISOString();
      const claim: ISessionDelegateCycleClaim = {
        ...key,
        delegationTraceId,
        state: SessionDelegateCycleClaimStateSchema.enum.claimed,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      claims.set(claimKeyString(key), claim);
      return Promise.resolve({ outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired, claim });
    },
    reclaimPreLaunch(
      key: ISessionDelegateCycleClaimKey,
      delegationTraceId: string,
    ): Promise<ISessionDelegateCycleClaimAcquireResult> {
      const current = claims.get(claimKeyString(key));
      if (!current || current.state !== SessionDelegateCycleClaimStateSchema.enum.claimed) {
        return Promise.resolve({
          outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.existing,
          claim: current as ISessionDelegateCycleClaim,
        });
      }
      const claim: ISessionDelegateCycleClaim = { ...current, delegationTraceId, updatedAt: new Date().toISOString() };
      claims.set(claimKeyString(key), claim);
      return Promise.resolve({ outcome: SessionDelegateCycleClaimAcquireOutcomeSchema.enum.acquired, claim });
    },
    transition(
      key: ISessionDelegateCycleClaimKey,
      state: ISessionDelegateCycleClaimState,
      input?: Opt<ISessionDelegateCycleClaimTransitionInput, Reason.OptionalInput>,
    ): Promise<void> {
      const current = claims.get(claimKeyString(key));
      if (!current) return Promise.resolve();
      claims.set(claimKeyString(key), {
        ...current,
        state,
        outcome: input?.outcome ?? current.outcome,
        failureReason: input?.failureReason ?? current.failureReason,
        updatedAt: new Date().toISOString(),
      });
      return Promise.resolve();
    },
    get(key: ISessionDelegateCycleClaimKey): Promise<ISessionDelegateCycleClaim | null> {
      return Promise.resolve(claims.get(claimKeyString(key)) ?? null);
    },
    getByDelegationTraceId(delegationTraceId: string): Promise<ISessionDelegateCycleClaim | null> {
      for (const claim of claims.values()) {
        if (claim.delegationTraceId === delegationTraceId) return Promise.resolve(claim);
      }
      return Promise.resolve(null);
    },
  };
}
