/**
 * @module OnReconciledDispatcher
 * @path apps/daemon/src/on_reconciled_dispatcher.ts
 * @description Phase 111 Step 6 — gate-based dispatch for the onReconciled callback
 *   on SessionReturnWatcher. Reads the brief to determine the gate, then maps
 *   the delegated return to the correct artifact via the gate mappers. Also mints
 *   an execution record from the reconciled outcome and the brief, then runs the
 *   same curated extraction as the plan path, so delegated sessions feed the
 *   identical Pending → approval workflow.
 * @architectural-layer Application
 * @dependencies [@exaix/schemas, @exaix/session, @exaix/core]
 * @related-files [apps/daemon/main.ts, packages/session/src/gate_mappers.ts, packages/core/src/artifact/mission_reporter.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { DomainEventType } from "@exaix/core/events";
import { DEFAULT_PORTALS_PATH, DEFAULT_UNKNOWN_LABEL, ExecutionStatus } from "@exaix/core/types";
import type { CostSource, Opt, Reason } from "@exaix/core/types";
import { SessionGateSchema } from "@exaix/schemas/session_delegate.ts";
import type { IReviewStatus } from "@exaix/core/status";
import type { ISessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import type { ISessionDelegationOutcome } from "@exaix/session/session_delegation.ts";
import {
  buildAmendmentDecision,
  buildClarificationFromDelegation,
  buildReviewDecisionPatch,
} from "@exaix/session/gate_mappers.ts";
import { sessionReturnToCostRecord } from "@exaix/session/cost_mapping.ts";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";

/** Shape of a structural-log payload (avoids bare generic object). */
export interface ILogPayload {
  [key: string]: string | number | boolean | null | undefined;
}

/** `traceId` mirrors IEventLogger.info's real 4th parameter — populates the persisted
 *  row's trace_id column so `trace_scoped: true` journal-assert steps can find it. */
export interface IReconciledLogger {
  info(event: string, target: string, payload?: ILogPayload, traceId?: string): void;
}

export interface IOnReconciledDeps {
  briefReader: ISessionBriefReader;
  workspaceRoot: string;
  reviewRegistry: {
    getByTrace(traceId: string): Promise<Array<{ id: string }>>;
    updateStatus(id: string, status: IReviewStatus, user?: string, reason?: string): Promise<void>;
  };
  costTracker?: {
    trackGeneration(
      provider: string,
      model: string,
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUsd?: number;
        costSource?: CostSource;
      },
      traceId?: string,
    ): Promise<number>;
  };
  logger: IReconciledLogger;
  /** Mints the delegated session's execution record; optional so existing callers
   *  without a memory lifecycle keep working unchanged. */
  memoryBank?: {
    createExecutionRecord(execution: IExecutionMemory): Promise<void>;
  };
  /** Runs the same curated extraction pipeline used on the plan path. */
  extractor?: {
    analyzeExecution(execution: IExecutionMemory): Promise<IProposalLearning[]>;
    createProposal(learning: IProposalLearning, execution: IExecutionMemory, identityId: string): Promise<string>;
  };
}

/** Portal name embedded in `worktreePath` as `.../Portals/<name>/...`; falls back to
 *  the shared "unknown" sentinel when no Portals segment is present. */
function portalFromWorktreePath(worktreePath?: Opt<string, Reason.SensibleDefault>): string {
  if (!worktreePath) return DEFAULT_UNKNOWN_LABEL;
  const parts = worktreePath.split("/");
  const portalIndex = parts.indexOf(DEFAULT_PORTALS_PATH);
  if (portalIndex >= 0 && portalIndex + 1 < parts.length) {
    return parts[portalIndex + 1];
  }
  return DEFAULT_UNKNOWN_LABEL;
}

/** @returns An onReconciled callback suitable for SessionReturnWatcher. */
export function createOnReconciledHandler(
  deps: IOnReconciledDeps,
): (outcome: ISessionDelegationOutcome) => Promise<void> {
  const dispatched = new Map<string, Promise<void>>();
  return async (outcome: ISessionDelegationOutcome): Promise<void> => {
    const existing = dispatched.get(outcome.delegationTraceId);
    if (existing) return await existing;
    const dispatch = dispatchReconciledOutcome(deps, outcome);
    dispatched.set(outcome.delegationTraceId, dispatch);
    await dispatch;
  };
}

async function dispatchReconciledOutcome(
  deps: IOnReconciledDeps,
  outcome: ISessionDelegationOutcome,
): Promise<void> {
  const traceId = outcome.delegationTraceId;
  try {
    const brief = await deps.briefReader.read(traceId);
    if (!outcome.decision || !outcome.tokenStats) {
      throw new Error("accepted delegation outcome is incomplete");
    }
    const sessionResult = {
      decision: outcome.decision,
      summary: outcome.summary,
      token_stats: outcome.tokenStats,
      cost_usd: outcome.costUsd,
    };
    try {
      switch (brief.gate) {
        case "refinement": {
          const requestId = brief.artifact_ref
            .replace("Workspace/Requests/", "")
            .replace(".md", "");
          const clarification = buildClarificationFromDelegation({
            requestId,
            originalBody: brief.objective,
            sessionReturn: sessionResult,
          });
          const clarDir = join(deps.workspaceRoot, "Clarifications");
          await ensureDir(clarDir);
          await Deno.writeTextFile(
            join(clarDir, `${traceId}.json`),
            JSON.stringify(clarification, null, 2),
          );
          deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
            gate: "refinement",
            status: clarification.status,
          }, traceId);
          break;
        }
        case "plan_review": {
          const amendment = buildAmendmentDecision({
            amendmentId: crypto.randomUUID(),
            sessionReturn: sessionResult,
            decidedBy: `session:${brief.tool}`,
            now: new Date().toISOString(),
          });
          const amendDir = join(deps.workspaceRoot, "Amendments");
          await ensureDir(amendDir);
          await Deno.writeTextFile(
            join(amendDir, `${traceId}.json`),
            JSON.stringify(amendment, null, 2),
          );
          deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
            gate: "plan_review",
            decision: amendment.decision,
          }, traceId);
          break;
        }
        case SessionGateSchema.enum.review: {
          const patch = buildReviewDecisionPatch(sessionResult);
          const reviews = await deps.reviewRegistry.getByTrace(traceId);
          if (reviews.length === 0) {
            deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
              gate: SessionGateSchema.enum.review,
              error: "no matching review found for trace",
              status: patch.status,
              rejection_reason: patch.rejection_reason ?? null,
            }, traceId);
            break;
          }
          await deps.reviewRegistry.updateStatus(
            reviews[0].id,
            patch.status,
            `session:${brief.tool}`,
            patch.rejection_reason,
          );
          deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
            gate: SessionGateSchema.enum.review,
            status: patch.status,
          }, traceId);
          break;
        }
      }

      // Record cost for every accepted reconcile (P2, non-blocking)
      if (deps.costTracker) {
        const costRecord = sessionReturnToCostRecord({
          id: crypto.randomUUID(),
          tool: brief.tool,
          sessionReturn: sessionResult,
          costUsd: outcome.costUsd,
          traceId,
          timestamp: new Date(),
        });
        await deps.costTracker.trackGeneration(
          costRecord.provider,
          costRecord.model,
          {
            promptTokens: costRecord.promptTokens,
            completionTokens: costRecord.completionTokens,
            totalTokens: costRecord.tokens,
            // The delegate's reported session cost is authoritative.
            costUsd: outcome.costUsd,
            costSource: outcome.costUsd !== undefined ? "provider_reported" : undefined,
          },
          costRecord.traceId,
        );
      }

      // Mint the execution record from the return's own validated fields plus the
      // brief's identity_id/worktree_path; transcript_ref stays opaque and unparsed.
      if (deps.memoryBank && deps.extractor) {
        const now = new Date().toISOString();
        const executionMemory: IExecutionMemory = {
          trace_id: traceId,
          request_id: outcome.parentTraceId,
          started_at: now,
          completed_at: now,
          status: ExecutionStatus.COMPLETED,
          portal: portalFromWorktreePath(brief.worktree_path),
          identity_id: brief.identity_id,
          summary: outcome.summary,
          context_files: [],
          context_portals: [portalFromWorktreePath(brief.worktree_path)],
          changes: {
            files_created: [],
            files_modified: outcome.pathsTouched,
            files_deleted: [],
          },
        };
        await deps.memoryBank.createExecutionRecord(executionMemory);
        const candidates = await deps.extractor.analyzeExecution(executionMemory);
        for (const candidate of candidates) {
          await deps.extractor.createProposal(candidate, executionMemory, brief.identity_id);
        }
      }
    } catch {
      deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
        error: "post-reconcile dispatch failed",
        gate: "unknown",
      }, traceId);
    }
  } catch {
    deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
      error: "post-reconcile dispatch failed",
      gate: "unknown",
    }, traceId);
  }
}
