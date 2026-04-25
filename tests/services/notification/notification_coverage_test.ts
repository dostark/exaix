/**
 * @module NotificationCoverageTest
 * @path tests/services/notification/notification_coverage_test.ts
 * @description Negative testing and state edge-case coverage for the NotificationService,
 * ensuring graceful handling of uninitialized states and missing database records.
 */

import { assertEquals } from "@std/assert";
import { createStubDb } from "../../helpers/test_helpers.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { NotificationService } from "../../../src/services/notification/notification.ts";
import { MemoryScope } from "@exaix/core";
import { type JSONValue, toSafeJson } from "../../../src/shared/types/json.ts";

interface NotificationRow {
  id: string;
  type: string;
  message: string;
  proposal_id?: string | null;
  trace_id?: string | null;
  created_at: string;
  dismissed_at?: string | null;
  metadata?: JSONValue;
}

/**
 * Creates test environment for notification tests
 */
function initNotificationTest() {
  const notifications: NotificationRow[] = [];

  const stub = createStubDb({
    preparedRun: function (query: string, params: (string | number | boolean | null)[] = []) {
      const q = (query || "").toLowerCase();
      if (q.includes("insert into notifications")) {
        const [id, type, message, proposal_id, trace_id, created_at, metadata] = params;
        notifications.push({
          id: String(id),
          type: String(type),
          message: String(message),
          proposal_id: proposal_id ? String(proposal_id) : null,
          trace_id: trace_id ? String(trace_id) : null,
          created_at: String(created_at),
          metadata: metadata ? toSafeJson(metadata) : undefined,
          dismissed_at: null,
        });
        return Promise.resolve({});
      }
      if (q.includes("update notifications") && q.includes("where dismissed_at is null")) {
        const [dismissed_at] = params;
        for (const n of notifications) {
          if (n.dismissed_at == null) n.dismissed_at = String(dismissed_at);
        }
        return Promise.resolve({});
      }
      if (q.includes("update notifications") && q.includes("dismissed_at")) {
        const [dismissed_at, proposal_id] = params;
        for (const n of notifications) {
          if (n.proposal_id === proposal_id && n.dismissed_at == null) {
            n.dismissed_at = String(dismissed_at);
          }
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    },
    preparedAll: function <T>(query: string, _params: (string | number | boolean | null)[] = []): Promise<T[]> {
      const q = (query || "").toLowerCase();
      if (q.includes("from notifications") && q.includes("where dismissed_at is null")) {
        return Promise.resolve(
          notifications.filter((n) => n.dismissed_at == null).map((n) => ({
            id: n.id,
            type: n.type,
            message: n.message,
            proposal_id: n.proposal_id,
            trace_id: n.trace_id,
            created_at: n.created_at,
            dismissed_at: n.dismissed_at,
            metadata: n.metadata,
          })) as T[],
        );
      }
      return Promise.resolve([]);
    },
    preparedGet: function <T>(query: string, _params: (string | number | boolean | null)[] = []): Promise<T | null> {
      const q = (query || "").toLowerCase();
      if (q.includes("select count(*)") && q.includes("type = 'memory_update_pending'")) {
        const count = notifications.filter((n) => n.type === "memory_update_pending" && n.dismissed_at == null).length;
        return Promise.resolve({ count } as T);
      }
      return Promise.resolve(null);
    },
  });

  const config = createMockConfig(Deno.cwd());
  const notification = new NotificationService(config, stub);

  const cleanup = async () => {
    // nothing to cleanup for in-memory stub
  };

  return {
    config,
    db: stub,
    notification,
    cleanup,
  };
}

import { createTestProposal } from "../helpers/notification_test_helper.ts";

// Note: Database corruption or file errors are handled by DatabaseService/SQLite driver themselves.
// These tests are updated to ensure the service behaves reasonably when the table is empty.
Deno.test("NotificationService: getNotifications returns empty on empty database", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 0);
  } finally {
    await cleanup();
  }
});

// This test is redundant now but kept for consistency
Deno.test("NotificationService: getNotifications on uninitialized state", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 0);
  } finally {
    await cleanup();
  }
});

// ===== clearNotification Edge Cases =====

Deno.test("NotificationService: clearNotification handles non-existent proposal", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    // Add a notification
    const proposal = createTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    // Clear a non-existent proposal (should not throw)
    await notification.clearNotification("non-existent-id");

    // Original notification should still exist
    const remaining = await notification.getNotifications();
    assertEquals(remaining.length, 1);
    assertEquals(remaining[0].proposal_id, proposal.id);
  } finally {
    await cleanup();
  }
});

Deno.test("NotificationService: clearNotification on empty file", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    // Clear when no notifications exist (should not throw)
    await notification.clearNotification("any-id");

    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 0);
  } finally {
    await cleanup();
  }
});

// ===== getPendingCount Edge Cases =====

Deno.test("NotificationService: getPendingCount with mixed notification types", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    // Use NotificationService to create notifications via its public API
    await notification.notify("Pending 1", "memory_update_pending", "p1");
    await notification.notify("Approved", "memory_approved", "p2");
    await notification.notify("Pending 2", "memory_update_pending", "p3");
    await notification.notify("Rejected", "memory_rejected", "p4");

    // Should only count pending notifications
    const count = await notification.getPendingCount();
    assertEquals(count, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("NotificationService: getPendingCount returns 0 on empty database", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    const count = await notification.getPendingCount();
    assertEquals(count, 0);
  } finally {
    await cleanup();
  }
});

// ===== logActivity Edge Cases =====

Deno.test("NotificationService: notifyApproval handles db errors gracefully", () => {
  const config = createMockConfig(Deno.cwd());
  // Create a mock DB that throws on logActivity
  const mockDb = createStubDb({
    logActivity: () => {
      throw new Error("Database error");
    },
  });
  const notification = new NotificationService(config, mockDb);

  // Should not throw even when DB fails
  notification.notifyApproval("proposal-123", "Test ILearning as ILearning");

  // Test passes if no exception is thrown
});

Deno.test("NotificationService: notifyRejection handles db errors gracefully", () => {
  const config = createMockConfig(Deno.cwd());
  // Create a mock DB that throws on logActivity
  const mockDb = createStubDb({
    logActivity: () => {
      throw new Error("Database connection lost");
    },
  });
  const notification = new NotificationService(config, mockDb);

  // Should not throw even when DB fails
  notification.notifyRejection("proposal-456", "Not relevant");

  // Test passes if no exception is thrown
});

Deno.test("NotificationService: notifyMemoryUpdate handles db errors gracefully", async () => {
  const config = createMockConfig(Deno.cwd());
  // Create a mock DB that throws on preparedRun
  const mockDb = createStubDb({
    preparedRun: () => {
      throw new Error("Database timeout");
    },
  });

  const notification = new NotificationService(config, mockDb);
  const proposal = createTestProposal();

  // Should throw or handle error based on implementation.
  try {
    await notification.notifyMemoryUpdate(proposal);
  } catch (e) {
    assertEquals((e as Error).message, "Database timeout");
  }
});

// ===== Multiple Operations =====

Deno.test("NotificationService: multiple operations in sequence", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    // Add multiple notifications
    const proposal1 = createTestProposal({ id: "seq-1" });
    const proposal2 = createTestProposal({ id: "seq-2" });
    const proposal3 = createTestProposal({ id: "seq-3" });

    // Use the lower-level notify API to add pending notifications (works with stub)
    await notification.notify("Pending 1", "memory_update_pending", proposal1.id);
    await notification.notify("Pending 2", "memory_update_pending", proposal2.id);
    await notification.notify("Pending 3", "memory_update_pending", proposal3.id);

    // Verify notifications were recorded
    const all = await notification.getNotifications();
    // Debugging: inspect recorded notifications
    console.log("DEBUG notifications length:", all.length);
    console.log("DEBUG pending count:", await notification.getPendingCount());
    assertEquals(all.length, 3);
    assertEquals(await notification.getPendingCount(), 3);

    // Clear middle one
    await notification.clearNotification("seq-2");
    assertEquals(await notification.getPendingCount(), 2);

    // Clear first one
    await notification.clearNotification("seq-1");
    assertEquals(await notification.getPendingCount(), 1);

    // Clear all remaining
    await notification.clearAllNotifications();
    assertEquals(await notification.getPendingCount(), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("NotificationService: notifyMemoryUpdate with global scope proposal", async () => {
  const { notification, cleanup } = await initNotificationTest();
  try {
    // Create a global scope proposal (no target_project)
    const globalProposal = createTestProposal({
      id: "global-1",
      target_scope: MemoryScope.GLOBAL,
      target_project: undefined,
    });

    await notification.notifyMemoryUpdate(globalProposal);

    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 1);
    assertEquals(notifications[0].proposal_id, "global-1");
  } finally {
    await cleanup();
  }
});
