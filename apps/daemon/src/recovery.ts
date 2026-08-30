/**
 * @module CrashRecovery
 * @path apps/daemon/src/recovery.ts
 * @description Phase 121 Step 3 — daemon crash recovery for orphaned session
 *   delegations. Scans the activity journal for `session.delegate.launched`
 *   events without a matching terminal event and re-queues them as crash-recovery
 *   request files. Runs at daemon startup, best-effort (never blocks). Phase 174
 *   Step 4: a cycle-owned launch (`cycle_owned: true` on the launched payload) is
 *   routed through the durable claim instead — it never enters the human-review
 *   queue, since the next resume of that session_delegate_cycle step reclaims or
 *   awaits its claim on its own.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas, @std/path, @std/fs]
 * @related-files [apps/daemon/main.ts, packages/core/src/types/constants.ts, packages/session/src/session_delegate_cycle_claim_store.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { DomainEventType } from "@exaix/core/events";
import { CRASH_RECOVERY_LOOKBACK_MS } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { IEventLogger } from "@exaix/core/logger";
import type { ISessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import {
  type ISessionDelegateCycleClaimState,
  type ISessionDelegateCycleClaimStore,
  SessionDelegateCycleClaimStateSchema,
} from "@exaix/session/session_delegate_cycle_claim_store.ts";

export interface IRecoveryDeps {
  db: IDatabaseService;
  logger: IEventLogger;
  workspaceRoot: string;
  briefReader?: ISessionBriefReader;
  claimStore?: ISessionDelegateCycleClaimStore;
}

const NON_TERMINAL_CLAIM_STATES: ReadonlySet<ISessionDelegateCycleClaimState> = new Set([
  SessionDelegateCycleClaimStateSchema.enum.claimed,
  SessionDelegateCycleClaimStateSchema.enum.launched,
  SessionDelegateCycleClaimStateSchema.enum.returned,
]);

/** Categorical failure reason for a cycle-owned claim orphaned by a daemon crash. */
const ORPHANED_NO_TERMINAL_EVENT_REASON = "orphaned_no_terminal_event";

/** Terminal events that mark a delegation as complete (not orphaned). */
const TERMINAL_EVENTS = new Set([
  "session.delegate.returned",
  "session.delegate.reconciled",
  "session.delegate.cancelled",
  "session.delegate.expired",
]);

/** Scans the journal for orphaned session delegations and re-queues them. */
export async function recoverOrphanedDelegations(deps: IRecoveryDeps): Promise<number> {
  try {
    const launched = await deps.db.getActivitiesByActionTypeSafe("session.delegate.launched");
    if (launched.length === 0) return 0;

    const cutoff = new Date(Date.now() - CRASH_RECOVERY_LOOKBACK_MS).toISOString();
    const recovered: string[] = [];

    for (const record of launched) {
      // Skip records outside the lookback window
      if (record.timestamp < cutoff) continue;

      // Check for any terminal event for this trace
      const traceEvents = await deps.db.getActivitiesByTraceSafe(record.trace_id);
      const hasTerminal = traceEvents.some((e) => TERMINAL_EVENTS.has(e.action_type));
      if (hasTerminal) continue;

      const traceId = record.trace_id;

      // A cycle-owned launch is never re-queued as a human-review request — its durable
      // claim is the authority; the next resume of that session_delegate_cycle step
      // reclaims (pre-launch) or awaits (post-launch) it.
      let cycleOwned = false;
      try {
        cycleOwned = JSON.parse(record.payload).cycle_owned === true;
      } catch {
        // Legacy/malformed payloads are never cycle-owned.
      }
      if (cycleOwned) {
        if (deps.claimStore) {
          const claim = await deps.claimStore.getByDelegationTraceId(traceId);
          if (claim && NON_TERMINAL_CLAIM_STATES.has(claim.state)) {
            await deps.claimStore.transition(
              {
                parentTraceId: claim.parentTraceId,
                parentStepId: claim.parentStepId,
                sequence: claim.sequence,
                planDigest: claim.planDigest,
              },
              SessionDelegateCycleClaimStateSchema.enum.failed,
              { failureReason: ORPHANED_NO_TERMINAL_EVENT_REASON },
            );
          }
        }
        await deps.logger.log({
          action: DomainEventType.SessionDelegateCrashRecovered,
          target: traceId,
          traceId,
          payload: { trace_id: traceId, cycle_owned: true },
        });
        continue;
      }

      // Orphaned — reconstruct and re-queue
      const requestsDir = join(deps.workspaceRoot, "Workspace", "Requests");
      await ensureDir(requestsDir);
      const requestPath = join(requestsDir, `${traceId}_crash_recovery.md`);

      // Prefer the validated brief artifact. Legacy journal rows may predate the
      // reader wiring, so their redaction-free payload remains a compatibility fallback.
      let briefContent = "The original delegation brief is not available.";
      try {
        if (deps.briefReader) {
          briefContent = (await deps.briefReader.read(traceId)).objective;
        } else {
          const payload = JSON.parse(record.payload);
          briefContent = payload.brief ?? payload.content ?? briefContent;
        }
      } catch {
        // Missing/invalid legacy recovery input uses the non-sensitive default.
      }

      const body = [
        "# Crash-Recovery Request",
        "",
        "**AUTO-GENERATED — HUMAN REVIEW REQUIRED**",
        "",
        "This request was automatically re-queued after a daemon crash.",
        `Original trace: ${traceId}`,
        "",
        briefContent,
      ].join("\n");

      await Deno.writeTextFile(requestPath, body);

      // Emit recovery event
      await deps.logger.log({
        action: DomainEventType.SessionDelegateCrashRecovered,
        target: traceId,
        traceId,
        payload: {
          trace_id: traceId,
          request_path: `Workspace/Requests/${traceId}_crash_recovery.md`,
          recovered_count: recovered.length + 1,
        },
      });

      recovered.push(traceId);
    }

    return recovered.length;
  } catch {
    deps.logger.info(DomainEventType.SessionDelegateCrashRecovered, "crash-recovery", {
      error: "crash recovery failed",
    });
    return 0;
  }
}
