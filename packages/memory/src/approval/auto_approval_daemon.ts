/**
 * @module AutoApprovalDaemon
 * @path packages/memory/src/approval/auto_approval_daemon.ts
 * @description Daemon maintenance helper that schedules memory auto-approval
 * and emits pending memory digest notifications.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [apps/daemon/main.ts, packages/memory/src/approval/memory_auto_approval_service.ts, packages/core/src/notification/notification.ts]
 */
import type { IEventLogger } from "@exaix/core/logger";
import type { MemoryAutoApprovalService } from "./memory_auto_approval_service.ts";
import type { MemoryExtractorService } from "../extraction/memory_extractor.ts";
import type { INotificationService } from "@exaix/core/types";

export async function initializeMemoryAutoApprovalMaintenance(
  notificationService: Pick<INotificationService, "notifyPendingDigestIfNeeded">,
  memoryExtractor: Pick<MemoryExtractorService, "listPending">,
  autoApprovalService: Pick<MemoryAutoApprovalService, "runApprovalCycle">,
  logger: IEventLogger,
  intervalMs = 60 * 60 * 1000,
): Promise<{ stop: () => void }> {
  try {
    const pendingProposals = await memoryExtractor.listPending();
    const pendingCount = pendingProposals.length;
    const digestCreated = await notificationService.notifyPendingDigestIfNeeded(pendingCount);
    if (digestCreated) {
      await logger.info("memory.pending_digest", "Pending memory digest notification sent", {
        pendingCount,
      });
    }
  } catch (error) {
    await logger.error("memory.init_failed", "Memory auto-approval initialization failed", {
      error: String(error),
    });
  }

  const intervalId = setInterval(async () => {
    try {
      const result = await autoApprovalService.runApprovalCycle();
      if (result.promoted.length > 0) {
        await logger.info(
          "memory.auto_approval_cycle",
          `Promoted ${result.promoted.length} high-confidence learnings`,
          {
            promoted: result.promoted,
          },
        );
      }
    } catch (error) {
      await logger.error("memory.maintenance_cycle_failed", "Auto-approval maintenance cycle failed", {
        error: String(error),
      });
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(intervalId),
  };
}
