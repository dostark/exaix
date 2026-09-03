/**
 * @module NotificationTestHelper
 * @path packages/testing/src/helpers/services/notification_test_helper.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides common utilities for verifying TUI notification events,
 * simulating alert emission and history synchronization.
 */

import { initTestDbService } from "../init_db.ts";
import { NotificationService } from "@exaix/core/notification";
import type { IEventLogger } from "@exaix/core/logger";
import type { IDatabaseService, Opt, Reason } from "@exaix/core/types";
import type { ILogEvent, LogMetadata } from "@exaix/core";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { TEST_AGENT_NAME, TEST_ID, TEST_PROJECT_NAME, TEST_TIMESTAMP } from "../constants.ts";

/** Minimal IEventLogger adapter that writes directly to a DatabaseService. */
function makeDbLogger(db: IDatabaseService): IEventLogger {
  const write = (event: ILogEvent): Promise<void> => {
    db.logActivity("test", event.action, event.target || null, event.payload ?? {}, event.traceId);
    return Promise.resolve();
  };
  const shorthand = (
    action: string,
    target: string | null,
    payload?: Opt<LogMetadata, Reason.TestStub>,
    traceId?: Opt<string, Reason.TestStub>,
  ): Promise<void> => write({ action, target: target ?? "", payload: payload ?? {}, traceId });
  return {
    log: write,
    info: shorthand,
    warn: shorthand,
    error: shorthand,
    fatal: shorthand,
    debug: shorthand,
    child: () => makeDbLogger(db),
  };
}

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
  const notification = new NotificationService(config, db, makeDbLogger(db));

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
  idOrOverrides?: Opt<string | Partial<IMemoryUpdateProposal>, Reason.TestOverride>,
): IMemoryUpdateProposal {
  const overrides = typeof idOrOverrides === "string" ? { id: idOrOverrides } : idOrOverrides || {};

  return {
    id: overrides.id || crypto.randomUUID(),
    // ...
    created_at: TEST_TIMESTAMP,
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.PROJECT,
    target_project: TEST_PROJECT_NAME,
    learning: {
      id: crypto.randomUUID(),
      created_at: TEST_TIMESTAMP,
      source: MemoryBankSource.EXECUTION,
      scope: MemoryScope.PROJECT,
      project: TEST_PROJECT_NAME,
      title: "Test IPattern",
      description: "A test pattern for notifications",
      category: LearningCategory.PATTERN,
      tags: [TEST_ID],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      ...overrides.learning,
    },
    reason: "Extracted from execution",
    agent_role: TEST_AGENT_NAME,
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
