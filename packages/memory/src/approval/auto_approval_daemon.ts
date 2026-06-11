/**
 * @module AutoApprovalDaemon
 * @path packages/memory/src/approval/auto_approval_daemon.ts
 * @description Daemon maintenance helper that schedules memory auto-approval
 * and emits pending memory digest notifications.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [apps/daemon/main.ts, packages/memory/src/approval/memory_auto_approval_service.ts, packages/core/src/notification/notification.ts]
 */
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { MemoryAutoApprovalService } from "./memory_auto_approval_service.ts";
import type { MemoryExtractorService } from "../extraction/memory_extractor.ts";
import type { INotificationService } from "@exaix/core/types";
import type { SessionMemoryService } from "../session/session_memory.ts";
import type { MemoryBankService } from "../bank/memory_bank.ts";

export interface IMemoryMaintenanceOptions {
  notificationService: Pick<INotificationService, "notifyPendingDigestIfNeeded">;
  memoryExtractor: Pick<MemoryExtractorService, "listPending">;
  autoApprovalService: Pick<MemoryAutoApprovalService, "runApprovalCycle">;
  logger: IEventLogger;
  intervalMs?: number;
  sessionMemory?: Pick<SessionMemoryService, "promoteMemories">;
  memoryBank?: Pick<MemoryBankService, "rebuildIndices">;
}

export async function initializeMemoryAutoApprovalMaintenance(
  options: IMemoryMaintenanceOptions,
): Promise<{ stop: () => void }> {
  const {
    notificationService,
    memoryExtractor,
    autoApprovalService,
    logger,
    intervalMs = 60 * 60 * 1000,
    sessionMemory,
    memoryBank,
  } = options;

  try {
    const pendingProposals = await memoryExtractor.listPending();
    const pendingCount = pendingProposals.length;
    const digestCreated = await notificationService.notifyPendingDigestIfNeeded(pendingCount);
    if (digestCreated) {
      await logger.info(DomainEventType.MemoryPendingDigest, "Pending memory digest notification sent", {
        pendingCount,
      });
    }
  } catch (error) {
    await logger.error(DomainEventType.MemoryInitFailed, "Memory auto-approval initialization failed", {
      error: String(error),
    });
  }

  const intervalId = setInterval(async () => {
    try {
      const result = await autoApprovalService.runApprovalCycle();
      if (result.promoted.length > 0) {
        await logger.info(
          DomainEventType.MemoryAutoApprovalCycle,
          `Promoted ${result.promoted.length} high-confidence learnings`,
          {
            promoted: result.promoted,
          },
        );
      }
    } catch (error) {
      await logger.error(DomainEventType.MemoryMaintenanceCycleFailed, "Auto-approval maintenance cycle failed", {
        error: String(error),
      });
    }

    try {
      if (sessionMemory) {
        const promoted = await sessionMemory.promoteMemories();
        if (promoted > 0) {
          await logger.info(
            DomainEventType.MemoryTierPromotion,
            `Promoted ${promoted} tiered memory entries`,
            { promotedCount: promoted },
          );
        }
      }
    } catch (error) {
      await logger.error(DomainEventType.MemoryTierPromotionFailed, "Memory tier promotion cycle failed", {
        error: String(error),
      });
    }

    try {
      if (memoryBank) {
        await memoryBank.rebuildIndices();
        await logger.info(DomainEventType.MemoryIndicesRebuilt, "Periodic index rebuild completed");
      }
    } catch (error) {
      await logger.error(DomainEventType.MemoryIndexRebuildFailed, "Memory index rebuild cycle failed", {
        error: String(error),
      });
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(intervalId),
  };
}
