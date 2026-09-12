/**
 * @module SessionDelegation
 * @path packages/session/src/session_delegation.ts
 * @description Phase 174 Step 1 package-pure contracts and schemas for one
 *   lineage-linked session delegation and its durable reconciled outcome.
 * @architectural-layer Services
 * @dependencies [zod, @exaix/schemas]
 * @related-files [packages/session/src/session_delegation_result_store.ts, apps/daemon/src/session_delegation_coordinator.ts]
 */

import { z } from "zod";
import {
  SessionDecisionSchema,
  SessionReconcileRejectionSchema,
  SessionTokenStatsSchema,
} from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief, SessionReconcileRejection, SessionReturn } from "@exaix/schemas/session_delegate.ts";

/** Authority-free request accepted by the daemon-owned coordinator. */
export interface ISessionDelegationRequest {
  parentTraceId: string;
  parentStepId: string;
  sequence: number;
  /** The blueprint agent_role actually delegating this session. */
  agentRole: string;
  objective: string;
  acceptanceCriteria: string[];
  artifactRef: string;
  /** When present, `prepareBrief` resolves a real per-trace worktree path from this alias,
   *  overriding `worktreePath` below. Absent only for the native PlanExecutor delegate path,
   *  which already resolved its own isolated worktree and passes it via `worktreePath`. */
  portalAlias?: string;
  worktreePath: string;
  /** Pre-minted, durably claimed trace id the coordinator must use instead of minting its own; omitted callers get a coordinator-minted id. */
  delegationTraceId?: string;
}

/** Package contract implemented by the daemon-layer coordinator. */
export interface ISessionDelegationCoordinator {
  delegate(input: ISessionDelegationRequest): Promise<ISessionDelegationOutcome>;
}

/** Input used by the return processor to preserve one parsed return. */
export interface IBuildSessionDelegationOutcomeInput {
  brief: SessionBrief;
  sessionReturn: SessionReturn;
  accepted: boolean;
  rejection?: SessionReconcileRejection;
}

export const SessionDelegationStatusSchema = z.enum([
  "completed",
  "abandoned",
  "rejected",
  "expired",
  "cancelled",
  "launch_failed",
]);

export const SessionDelegationOutcomeSchema = z.object({
  delegationTraceId: z.string().uuid(),
  parentTraceId: z.string().uuid(),
  parentStepId: z.string().min(1),
  sequence: z.number().int().positive(),
  status: SessionDelegationStatusSchema,
  decision: SessionDecisionSchema.optional(),
  summary: z.string(),
  pathsTouched: z.array(z.string()),
  tokenStats: SessionTokenStatsSchema.optional(),
  costUsd: z.number().nonnegative().optional(),
  rejection: SessionReconcileRejectionSchema.optional(),
}).strict();

export type ISessionDelegationOutcome = z.infer<typeof SessionDelegationOutcomeSchema>;

export const SessionDelegationResultStateSchema = z.enum(["reconciled", "delivered"]);

export const SessionDelegationResultRecordSchema = z.object({
  state: SessionDelegationResultStateSchema,
  outcome: SessionDelegationOutcomeSchema,
  reconciledAt: z.string().datetime(),
  deliveredAt: z.string().datetime().optional(),
}).strict();

export type ISessionDelegationResultRecord = z.infer<typeof SessionDelegationResultRecordSchema>;

/** Strict redacted payload emitted immediately before a delegate spawn. */
export const SessionDelegateLaunchedPayloadSchema = z.object({
  trace_id: z.string().uuid(),
  parent_trace_id: z.string().uuid(),
  parent_step_id: z.string().min(1),
  sequence: z.number().int().positive(),
  gate: z.literal("code_changes"),
  tool: z.string().min(1),
  cycle_owned: z.boolean(),
  artifact_ref: z.string().min(1),
}).strict();

export type ISessionDelegateLaunchedPayload = z.infer<typeof SessionDelegateLaunchedPayloadSchema>;

/** Preserve the already-parsed return without reading return.json a second time. */
export function buildSessionDelegationOutcome(
  input: IBuildSessionDelegationOutcomeInput,
): ISessionDelegationOutcome {
  const status = input.accepted
    ? input.sessionReturn.decision === SessionDecisionSchema.enum.abandoned
      ? SessionDelegationStatusSchema.enum.abandoned
      : SessionDelegationStatusSchema.enum.completed
    : SessionDelegationStatusSchema.enum.rejected;
  return SessionDelegationOutcomeSchema.parse({
    delegationTraceId: input.brief.trace_id,
    parentTraceId: input.brief.parent_trace_id ?? input.brief.trace_id,
    parentStepId: input.brief.parent_step_id ?? input.brief.gate,
    sequence: input.brief.sequence ?? 1,
    status,
    decision: input.sessionReturn.decision,
    summary: input.sessionReturn.summary,
    pathsTouched: input.sessionReturn.paths_touched,
    tokenStats: input.sessionReturn.token_stats,
    costUsd: input.sessionReturn.cost_usd,
    rejection: input.rejection,
  });
}
