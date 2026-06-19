/**
 * @module OnReconciledDispatcher
 * @path apps/daemon/src/on_reconciled_dispatcher.ts
 * @description Phase 111 Step 6 — gate-based dispatch for the onReconciled callback
 *   on SessionReturnWatcher. Reads the brief to determine the gate, then maps
 *   the delegated return to the correct artifact via the gate mappers.
 * @architectural-layer Application
 * @dependencies [@exaix/schemas, @exaix/session, @exaix/core]
 * @related-files [apps/daemon/main.ts, packages/session/src/gate_mappers.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { DomainEventType } from "@exaix/core/events";
import { SessionBriefSchema, SessionGateSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { IReviewStatus } from "@exaix/core/status";
import {
  buildAmendmentDecision,
  buildClarificationFromDelegation,
  buildReviewDecisionPatch,
} from "@exaix/session/gate_mappers.ts";

/** Shape of a structural-log payload (avoids bare generic object). */
export interface ILogPayload {
  [key: string]: string | number | boolean | null | undefined;
}

export interface IReconciledLogger {
  info(event: string, target: string, payload?: ILogPayload): void;
}

export interface IOnReconciledDeps {
  sessionDir: string;
  workspaceRoot: string;
  reviewRegistry: {
    getByTrace(traceId: string): Promise<Array<{ id: string }>>;
    updateStatus(id: string, status: IReviewStatus, user?: string, reason?: string): Promise<void>;
  };
  logger: IReconciledLogger;
}

/** @returns An onReconciled callback suitable for SessionReturnWatcher. */
export function createOnReconciledHandler(
  deps: IOnReconciledDeps,
): (traceId: string, decision: string) => Promise<void> {
  return async (traceId: string, _decision: string): Promise<void> => {
    const briefPath = join(deps.sessionDir, traceId, "brief.json");
    const returnPath = join(deps.sessionDir, traceId, "return.json");

    try {
      const briefRaw = await Deno.readTextFile(briefPath);
      const brief = SessionBriefSchema.parse(JSON.parse(briefRaw));

      const returnRaw = await Deno.readTextFile(returnPath);
      const sessionReturn = SessionReturnSchema.parse(JSON.parse(returnRaw));

      switch (brief.gate) {
        case "refinement": {
          const requestId = brief.artifact_ref
            .replace("Workspace/Requests/", "")
            .replace(".md", "");
          const clarification = buildClarificationFromDelegation({
            requestId,
            originalBody: brief.objective,
            sessionReturn,
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
          });
          break;
        }
        case "plan_review": {
          const amendment = buildAmendmentDecision({
            amendmentId: crypto.randomUUID(),
            sessionReturn,
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
          });
          break;
        }
        case SessionGateSchema.enum.review: {
          const patch = buildReviewDecisionPatch(sessionReturn);
          const reviews = await deps.reviewRegistry.getByTrace(traceId);
          if (reviews.length === 0) {
            deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
              gate: SessionGateSchema.enum.review,
              error: "no matching review found for trace",
              status: patch.status,
              rejection_reason: patch.rejection_reason ?? null,
            });
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
          });
          break;
        }
      }
    } catch (err) {
      deps.logger.info(DomainEventType.SessionDelegateReconciled, traceId, {
        error: err instanceof Error ? err.message : String(err),
        gate: "unknown",
      });
    }
  };
}
