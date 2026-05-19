// deno-lint-ignore-file no-explicit-any
/**
 * @module MemoryAutoApprovalDaemonTest
 * @path tests/services/memory/memory_auto_approval_daemon_test.ts
 * @description Verifies the memory auto-approval daemon maintenance helper.
 */
import { assertEquals } from "@std/assert";
import type { EventLogger } from "@exaix/core/logger";
import { initializeMemoryAutoApprovalMaintenance } from "../../../src/services/memory/auto_approval_daemon.ts";
import type { IMemoryExtractorService } from "@exaix/core/types";
import type { MemoryAutoApprovalService } from "../../../src/services/memory/memory_auto_approval_service.ts";
import type { NotificationService } from "../../../src/services/notification/notification.ts";

interface MockMemoryExtractorService {
  listPending(): Promise<
    Array<{
      id: string;
      learning: {
        source: string;
        confidence: string;
        extracted_at: string;
      };
    }>
  >;
}

interface MockAutoApprovalService {
  runApprovalCycle(): Promise<{
    runAt: string;
    promoted: string[];
    skipped: string[];
    dryRun: boolean;
  }>;
}

interface MockLogger {
  info(message: string, ...args: Array<string | number | boolean | object | undefined | null>): Promise<void>;
}

type AssertionHelper = <T>(value: any) => T;
const asMock = (<T>(value: any) => value as T) as AssertionHelper;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("Memory auto-approval daemon emits pending digest and schedules approval cycles", async () => {
  let digestNotified = false;
  let approvalCycles = 0;

  const mockNotificationService = asMock<NotificationService>(
    {
      notifyPendingDigestIfNeeded: (pendingCount: number) => {
        assertEquals(pendingCount, 1);
        digestNotified = true;
        return Promise.resolve(true);
      },
    },
  );

  const mockMemoryExtractor = asMock<IMemoryExtractorService>(
    {
      listPending: () =>
        Promise.resolve([
          {
            id: "proposal-1",
            learning: {
              source: "execution",
              confidence: "VERY_HIGH",
              extracted_at: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
            },
          },
        ]),
    },
  );

  const mockAutoApprovalService = asMock<MemoryAutoApprovalService>(
    {
      runApprovalCycle: () => {
        approvalCycles += 1;
        return Promise.resolve({
          runAt: new Date().toISOString(),
          promoted: [],
          skipped: [],
          dryRun: false,
        });
      },
    },
  );

  const mockLogger = asMock<EventLogger>(
    {
      info: async () => {
        // No-op logger for test
      },
    },
  );

  const maintenance = await initializeMemoryAutoApprovalMaintenance(
    mockNotificationService,
    mockMemoryExtractor,
    mockAutoApprovalService,
    mockLogger,
    10,
  );

  await delay(50);
  maintenance.stop();

  assertEquals(digestNotified, true);
  assertEquals(approvalCycles >= 1, true);
});
