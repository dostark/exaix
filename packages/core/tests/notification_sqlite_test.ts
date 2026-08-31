/**
 * @module NotificationSQLiteTest
 * @path packages/core/tests/notification_sqlite_test.ts
 * @description Verifies the SQLite database schema and migrations for the notification system,
 * ensuring persistent storage of event alerts within the activity journal.
 */

import { assertEquals, assertExists } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { createNotificationTestProposal, runNotificationTest } from "@exaix/testing";

// Migration Tests

Deno.test("Migration 003: adds notifications table to journal.db", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // Check table exists
    const tables = db.instance.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'",
    ).all() as Array<{ name: string }>;

    assertEquals(tables.length, 1);
    assertEquals(tables[0].name, "notifications");

    // Check indexes exist
    const indexes = db.instance.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'",
    ).all() as Array<{ name: string }>;

    assertEquals(indexes.length >= 4, true, "Should have at least 4 indexes");
  } finally {
    await cleanup();
  }
});

Deno.test("Migration 003: notifications table has correct schema", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const columns = db.instance.prepare(
      "PRAGMA table_info(notifications)",
    ).all() as Array<{ name: string; type: string; notnull: number }>;

    const columnNames = columns.map((c) => c.name);
    assertEquals(columnNames.includes("id"), true);
    assertEquals(columnNames.includes("type"), true);
    assertEquals(columnNames.includes("message"), true);
    assertEquals(columnNames.includes("proposal_id"), true);
    assertEquals(columnNames.includes("trace_id"), true);
    assertEquals(columnNames.includes("created_at"), true);
    assertEquals(columnNames.includes("dismissed_at"), true);
    assertEquals(columnNames.includes("metadata"), true);
  } finally {
    await cleanup();
  }
});

// NotificationService SQLite Tests

Deno.test("NotificationService: inserts notification into database", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal = createNotificationTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    // Query directly from database
    const rows = db.instance.prepare(
      "SELECT * FROM notifications WHERE proposal_id = ?",
    ).all(proposal.id) as Array<{
      id: string;
      type: string;
      message: string;
      proposal_id: string;
      created_at: string;
    }>;

    assertEquals(rows.length, 1);
    assertEquals(rows[0].type, "memory_update_pending");
    assertEquals(rows[0].proposal_id, proposal.id);
    assertExists(rows[0].id);
    assertExists(rows[0].created_at);
  });
});

Deno.test("NotificationService: getNotifications queries active notifications", async () => {
  await runNotificationTest(async ({ notification }) => {
    const proposal = createNotificationTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    const notifications = await notification.getNotifications();

    assertEquals(notifications.length, 1);
    assertEquals(notifications[0].proposal_id, proposal.id);
    assertEquals(notifications[0].type, "memory_update_pending");
  });
});

Deno.test("NotificationService: getNotifications excludes dismissed notifications", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal1 = createNotificationTestProposal();
    const proposal2 = createNotificationTestProposal();

    await notification.notifyMemoryUpdate(proposal1);
    await notification.notifyMemoryUpdate(proposal2);

    // Manually dismiss one notification
    db.instance.prepare(
      "UPDATE notifications SET dismissed_at = ? WHERE proposal_id = ?",
    ).run(new Date().toISOString(), proposal1.id);

    const active = await notification.getNotifications();

    assertEquals(active.length, 1);
    assertEquals(active[0].proposal_id, proposal2.id);
  });
});

Deno.test("NotificationService: clearNotification soft-deletes with dismissed_at", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal = createNotificationTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    await notification.clearNotification(proposal.id);

    // Check dismissed_at is set
    const rows = db.instance.prepare(
      "SELECT dismissed_at FROM notifications WHERE proposal_id = ?",
    ).all(proposal.id) as Array<{ dismissed_at: string | null }>;

    assertEquals(rows.length, 1);
    assertExists(rows[0].dismissed_at);
  });
});

Deno.test("NotificationService: clearNotification only affects undismissed notifications", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal = createNotificationTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    // Clear once
    await notification.clearNotification(proposal.id);

    const firstDismissed = db.instance.prepare(
      "SELECT dismissed_at FROM notifications WHERE proposal_id = ?",
    ).get(proposal.id) as { dismissed_at: string };

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to clear again - should not update timestamp
    await notification.clearNotification(proposal.id);

    const secondDismissed = db.instance.prepare(
      "SELECT dismissed_at FROM notifications WHERE proposal_id = ?",
    ).get(proposal.id) as { dismissed_at: string };

    assertEquals(firstDismissed.dismissed_at, secondDismissed.dismissed_at);
  });
});

Deno.test("NotificationService: clearAllNotifications soft-deletes all active", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    await notification.notifyMemoryUpdate(createNotificationTestProposal());
    await notification.notifyMemoryUpdate(createNotificationTestProposal());
    await notification.notifyMemoryUpdate(createNotificationTestProposal());

    await notification.clearAllNotifications();

    // Check all have dismissed_at
    const rows = db.instance.prepare(
      "SELECT COUNT(*) as count FROM notifications WHERE dismissed_at IS NULL",
    ).get() as { count: number };

    assertEquals(rows.count, 0);
  });
});

Deno.test("NotificationService: getPendingCount returns correct count", async () => {
  await runNotificationTest(async ({ notification }) => {
    assertEquals(await notification.getPendingCount(), 0);

    await notification.notifyMemoryUpdate(createNotificationTestProposal());
    assertEquals(await notification.getPendingCount(), 1);

    await notification.notifyMemoryUpdate(createNotificationTestProposal());
    assertEquals(await notification.getPendingCount(), 2);

    // Clear one
    const notifications = await notification.getNotifications();
    await notification.clearNotification(notifications[0].proposal_id!);

    assertEquals(await notification.getPendingCount(), 1);
  });
});

Deno.test("NotificationService: handles concurrent inserts", async () => {
  await runNotificationTest(async ({ notification }) => {
    // Insert 10 notifications concurrently
    const proposals = Array.from({ length: 10 }, () => createNotificationTestProposal());

    await Promise.all(
      proposals.map((p) => notification.notifyMemoryUpdate(p)),
    );

    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 10);
  });
});

Deno.test("NotificationService: stores metadata as JSON", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal = createNotificationTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    const rows = db.instance.prepare(
      "SELECT metadata FROM notifications WHERE proposal_id = ?",
    ).all(proposal.id) as Array<{ metadata: string }>;

    assertEquals(rows.length, 1);
    const metadata = JSON.parse(rows[0].metadata);
    assertEquals(metadata.learning_title, proposal.learning.title);
    assertEquals(metadata.reason, proposal.reason);
  });
});

Deno.test("NotificationService: getNotifications returns empty array when none exist", async () => {
  await runNotificationTest(async ({ notification }) => {
    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 0);
  });
});
