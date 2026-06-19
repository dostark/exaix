/**
 * @module CrashRecovery
 * @path apps/daemon/src/recovery.ts
 * @description Phase 121 Step 3 — daemon crash recovery for orphaned session
 *   delegations. Scans the activity journal for `session.delegate.launched`
 *   events without a matching terminal event and re-queues them as crash-recovery
 *   request files. Runs at daemon startup, best-effort (never blocks).
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas, @std/path, @std/fs]
 * @related-files [apps/daemon/main.ts, packages/core/src/types/constants.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { DomainEventType } from "@exaix/core/events";
import { CRASH_RECOVERY_LOOKBACK_MS } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { IEventLogger } from "@exaix/core/logger";

export interface IRecoveryDeps {
  db: IDatabaseService;
  logger: IEventLogger;
  workspaceRoot: string;
}

/** Terminal events that mark a delegation as complete (not orphaned). */
const TERMINAL_EVENTS = new Set([
  "session.delegate.returned",
  "session.delegate.reconciled",
  "session.delegate.cancelled",
  "session.delegate.expired",
]);

/**
 * Scan the activity journal for orphaned session delegations and re-queue them.
 * Returns the number of recovered delegations.
 */
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

      // Orphaned — reconstruct and re-queue
      const traceId = record.trace_id;
      const requestsDir = join(deps.workspaceRoot, "Workspace", "Requests");
      await ensureDir(requestsDir);
      const requestPath = join(requestsDir, `${traceId}_crash_recovery.md`);

      // Reconstruct brief content from the launched event payload
      let briefContent = "The original delegation brief is not available.";
      try {
        const payload = JSON.parse(record.payload);
        briefContent = payload.brief ?? payload.content ?? briefContent;
      } catch {
        // Payload is not valid JSON — use default
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
          request_path: requestPath,
          recovered_count: recovered.length + 1,
        },
      });

      recovered.push(traceId);
    }

    return recovered.length;
  } catch (err) {
    deps.logger.info(DomainEventType.SessionDelegateCrashRecovered, "crash-recovery", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
