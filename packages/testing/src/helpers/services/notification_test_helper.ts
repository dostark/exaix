/**
 * @module NotificationTestHelper
 * @path tests/services/helpers/notification_test_helper.ts
 * @description Provides common utilities for verifying TUI notification events,
 * simulating alert emission and history synchronization.
 */

import { initTestDbService } from "../init_db.ts";
import { NotificationService } from "@exaix/core/notification";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";

/**
 * Creates test environment for notification tests
 */
export async function initNotificationTest(): Promise<{
  config: Awaited<ReturnType<typeof initTestDbService>>["config"];
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  notification: NotificationService;
  cleanup: () => Promise<void>;
}> {
  const { db, config, cleanup: dbCleanup } = await initTestDbService();
  const notification = new NotificationService(config, db);

  const cleanup = async () => {
    await dbCleanup();
  };

  return {
    config,
    db,
    notification,
    cleanup,
  };
}

/**
 * Creates a test proposal
 */
// ...
export function createNotificationTestProposal(
  idOrOverrides?: string | Partial<IMemoryUpdateProposal>,
): IMemoryUpdateProposal {
  const overrides = typeof idOrOverrides === "string" ? { id: idOrOverrides } : idOrOverrides || {};

  return {
    id: overrides.id || crypto.randomUUID(),
    // ...
    created_at: "2026-01-04T12:00:00Z",
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.PROJECT,
    target_project: "my-app",
    learning: {
      id: crypto.randomUUID(),
      created_at: "2026-01-04T12:00:00Z",
      source: MemoryBankSource.EXECUTION,
      scope: MemoryScope.PROJECT,
      project: "my-app",
      title: "Test IPattern",
      description: "A test pattern for notifications",
      category: LearningCategory.PATTERN,
      tags: ["test"],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      ...overrides.learning,
    },
    reason: "Extracted from execution",
    identity_id: "senior-coder",
    execution_id: "trace-123",
    status: MemoryStatus.PENDING,
    ...overrides,
  };
}

type NotificationTestContextKeys = "notification" | "db" | "config";

type INotificationTestContext = Pick<
  Awaited<ReturnType<typeof initNotificationTest>>,
  NotificationTestContextKeys
>;

/**
 * Helper wrapper for notification tests
 */
export async function runNotificationTest(
  fn: (ctx: INotificationTestContext) => Promise<void>,
): Promise<void> {
  const { db, config, notification, cleanup } = await initNotificationTest();
  try {
    await fn({ notification, db, config });
  } finally {
    await cleanup();
  }
}
