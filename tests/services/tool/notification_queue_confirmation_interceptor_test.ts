/**
 * @module NotificationQueueConfirmationInterceptorTest
 * @path tests/services/tool/notification_queue_confirmation_interceptor_test.ts
 * @description Tests the async DB-backed confirmation queue adapter for Phase 79.
 */

import { assertEquals } from "@std/assert";
import {
  TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
  TOOL_CONFIRMATION_EVENT_REQUESTED,
  TOOL_CONFIRMATION_NOTIFY_TYPE,
} from "@exaix/core";
import type { INotificationService } from "@exaix/core/types";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { IActivityJournal, JournalEntry } from "../../../src/flows/dynamic_step_executor.ts";
import { NotificationQueueConfirmationInterceptor } from "../../../src/services/tool/notification_queue_confirmation_interceptor.ts";
import { initTestDbService } from "../../helpers/db.ts";

class MockActivityJournal implements IActivityJournal {
  private entries: JournalEntry[] = [];

  getEntries(): JournalEntry[] {
    return [...this.entries];
  }

  log(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

class MockNotificationService implements Pick<INotificationService, "notify"> {
  calls: Array<{ message: string; type?: string; proposalId?: string; traceId?: string; metadata?: string }> = [];

  notify(
    message: string,
    type?: string,
    proposalId?: string,
    traceId?: string,
    metadata?: string,
  ): Promise<void> {
    this.calls.push({ message, type, proposalId, traceId, metadata });
    return Promise.resolve();
  }
}

function createRequest(id: string, expiresAt: string): ToolConfirmationRequest {
  return {
    id,
    toolName: "exaix_create_request",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "trace-1",
    requestedAt: "2026-05-18T10:00:00.000Z",
    expiresAt,
  };
}

Deno.test("NotificationQueueConfirmationInterceptor: resolves approval after queued decision", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const notificationService = new MockNotificationService();
    const activityJournal = new MockActivityJournal();
    const request = createRequest(crypto.randomUUID(), "2026-05-18T10:02:00.000Z");

    let wroteDecision = false;
    const interceptor = new NotificationQueueConfirmationInterceptor(
      db,
      notificationService,
      activityJournal,
      async () => {
        if (!wroteDecision) {
          wroteDecision = true;
          await db.writeToolConfirmationDecision(request.id, {
            approved: true,
            decidedAt: "2026-05-18T10:00:30.000Z",
            decidedBy: "senior-coder",
          });
        }
      },
      () => Date.parse("2026-05-18T10:00:30.000Z"),
    );

    const decision = await interceptor.requestApproval(request);

    assertEquals(decision, {
      id: request.id,
      approved: true,
      decidedAt: "2026-05-18T10:00:30.000Z",
      decidedBy: "senior-coder",
    });
    assertEquals(notificationService.calls[0].type, TOOL_CONFIRMATION_NOTIFY_TYPE);
    assertEquals(notificationService.calls[0].proposalId, request.id);
  } finally {
    await cleanup();
  }
});

Deno.test("NotificationQueueConfirmationInterceptor: resolves denial after queued decision", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const notificationService = new MockNotificationService();
    const activityJournal = new MockActivityJournal();
    const request = createRequest(crypto.randomUUID(), "2026-05-18T10:02:00.000Z");

    let wroteDecision = false;
    const interceptor = new NotificationQueueConfirmationInterceptor(
      db,
      notificationService,
      activityJournal,
      async () => {
        if (!wroteDecision) {
          wroteDecision = true;
          await db.writeToolConfirmationDecision(request.id, {
            approved: false,
            reason: "Denied",
            decidedAt: "2026-05-18T10:00:45.000Z",
            decidedBy: "senior-coder",
          });
        }
      },
      () => Date.parse("2026-05-18T10:00:45.000Z"),
    );

    const decision = await interceptor.requestApproval(request);

    assertEquals(decision, {
      id: request.id,
      approved: false,
      reason: "Denied",
      decidedAt: "2026-05-18T10:00:45.000Z",
      decidedBy: "senior-coder",
    });
  } finally {
    await cleanup();
  }
});

Deno.test("NotificationQueueConfirmationInterceptor: timeout auto-denies when no decision is written", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const notificationService = new MockNotificationService();
    const activityJournal = new MockActivityJournal();
    const request = createRequest(crypto.randomUUID(), "2026-05-18T10:02:00.000Z");

    let now = Date.parse("2026-05-18T10:01:00.000Z");
    const interceptor = new NotificationQueueConfirmationInterceptor(
      db,
      notificationService,
      activityJournal,
      () => {
        now = Date.parse("2026-05-18T10:03:00.000Z");
        return Promise.resolve();
      },
      () => now,
    );

    const decision = await interceptor.requestApproval(request);

    assertEquals(decision, {
      id: request.id,
      approved: false,
      reason: "TIMEOUT",
      decidedAt: "2026-05-18T10:03:00.000Z",
      decidedBy: TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
    });
  } finally {
    await cleanup();
  }
});

Deno.test("NotificationQueueConfirmationInterceptor: logs requested event exactly once", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const notificationService = new MockNotificationService();
    const activityJournal = new MockActivityJournal();
    const request = createRequest(crypto.randomUUID(), "2026-05-18T10:02:00.000Z");

    let now = Date.parse("2026-05-18T10:01:00.000Z");
    const interceptor = new NotificationQueueConfirmationInterceptor(
      db,
      notificationService,
      activityJournal,
      () => {
        now = Date.parse("2026-05-18T10:03:00.000Z");
        return Promise.resolve();
      },
      () => now,
    );

    await interceptor.requestApproval(request);

    assertEquals(activityJournal.getEntries().length, 1);
    assertEquals(activityJournal.getEntries()[0].event, TOOL_CONFIRMATION_EVENT_REQUESTED);
    assertEquals(activityJournal.getEntries()[0].toolName, request.toolName);
    assertEquals(activityJournal.getEntries()[0].stepId, request.stepId);
    assertEquals(activityJournal.getEntries()[0].traceId, request.traceId);
  } finally {
    await cleanup();
  }
});
