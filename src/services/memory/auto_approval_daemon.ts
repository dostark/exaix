/**
 * @module AutoApprovalDaemon
 * @path src/services/memory/auto_approval_daemon.ts
 * @description Daemon maintenance helper that schedules memory auto-approval
 * and emits pending memory digest notifications.
 * @architectural-layer Services
 * @related-files [src/main.ts, src/services/memory/memory_auto_approval_service.ts, src/services/notification/notification.ts]
 */
import type { EventLogger } from "../core/event_logger.ts";
import type { MemoryAutoApprovalService } from "./memory_auto_approval_service.ts";
import type { MemoryExtractorService } from "./memory_extractor.ts";
import type { NotificationService } from "../notification/notification.ts";

type INotificationServiceMinimal = Pick<NotificationService, "notifyPendingDigestIfNeeded">;
type IMemoryExtractorServiceMinimal = Pick<MemoryExtractorService, "listPending">;
type IAutoApprovalServiceMinimal = Pick<MemoryAutoApprovalService, "runApprovalCycle">;
type ILoggerMinimal = Pick<EventLogger, "info">;

export async function initializeMemoryAutoApprovalMaintenance(
  notificationService: INotificationServiceMinimal,
  memoryExtractor: IMemoryExtractorServiceMinimal,
  autoApprovalService: IAutoApprovalServiceMinimal,
  logger: ILoggerMinimal,
  intervalMs = 60 * 60 * 1000,
): Promise<{ stop: () => void }> {
  const pendingProposals = await memoryExtractor.listPending();
  const pendingCount = pendingProposals.length;
  const digestCreated = await notificationService.notifyPendingDigestIfNeeded(pendingCount);

  if (digestCreated) {
    await logger.info("memory.pending_digest", "Pending memory digest notification sent", {
      pendingCount,
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
      console.error("[AutoApproval] Maintenance cycle failed:", error);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(intervalId),
  };
}
