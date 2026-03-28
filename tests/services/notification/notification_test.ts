/**
 * @module NotificationServiceTest
 * @path tests/services/notification_test.ts
 * @description Verifies the notification dispatch system, ensuring updates to memory banks
 * and long-running operations are correctly relayed to users via the DatabaseService.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { createTestProposal, runNotificationTest } from "../helpers/notification_test_helper.ts";

// ===== NotificationService Tests =====

Deno.test("NotificationService: notifyMemoryUpdate logs to IActivity Journal", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal = createTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    // Wait for batch flush
    await db.waitForFlush();

    // Check IActivity Journal
    const activities = db.instance.prepare(
      "SELECT action_type, target, payload FROM activity WHERE action_type = 'memory.update.pending'",
    ).all() as Array<{ action_type: string; target: string; payload: string }>;
    assertEquals(activities.length, 1);
    assertStringIncludes(activities[0].payload, proposal.id);
  });
});

Deno.test("NotificationService: notifyMemoryUpdate writes notification to database", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    const proposal = createTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    // Check notification was written to database
    const rows = db.instance.prepare(
      "SELECT * FROM notifications WHERE proposal_id = ?",
    ).all(proposal.id) as Array<{
      id: string;
      type: string;
      message: string;
      proposal_id: string;
    }>;

    assertEquals(rows.length, 1);
    assertEquals(rows[0].proposal_id, proposal.id);
    assertEquals(rows[0].type, "memory_update_pending");
  });
});

Deno.test("NotificationService: notifyMemoryUpdate appends to existing notifications", async () => {
  await runNotificationTest(async ({ notification }) => {
    const proposal1 = createTestProposal();
    const proposal2 = {
      ...createTestProposal(),
      id: "550e8400-e29b-41d4-a716-446655440002",
    };

    await notification.notifyMemoryUpdate(proposal1);
    await notification.notifyMemoryUpdate(proposal2);

    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 2);
  });
});

Deno.test("NotificationService: getNotifications returns all pending", async () => {
  await runNotificationTest(async ({ notification }) => {
    const proposal = createTestProposal();
    await notification.notifyMemoryUpdate(proposal);

    const notifications = await notification.getNotifications();

    assertEquals(notifications.length, 1);
    assertEquals(notifications[0].proposal_id, proposal.id);
    assertExists(notifications[0].created_at);
  });
});

Deno.test("NotificationService: getNotifications returns empty array if none", async () => {
  await runNotificationTest(async ({ notification }) => {
    const notifications = await notification.getNotifications();
    assertEquals(notifications.length, 0);
  });
});

Deno.test("NotificationService: clearNotification removes specific notification", async () => {
  await runNotificationTest(async ({ notification }) => {
    const proposal1 = createTestProposal();
    const proposal2 = {
      ...createTestProposal(),
      id: "550e8400-e29b-41d4-a716-446655440003",
    };

    await notification.notifyMemoryUpdate(proposal1);
    await notification.notifyMemoryUpdate(proposal2);

    await notification.clearNotification(proposal1.id);

    const remaining = await notification.getNotifications();
    assertEquals(remaining.length, 1);
    assertEquals(remaining[0].proposal_id, proposal2.id);
  });
});

Deno.test("NotificationService: clearAllNotifications removes all", async () => {
  await runNotificationTest(async ({ notification }) => {
    const proposal1 = createTestProposal();
    const proposal2 = {
      ...createTestProposal(),
      id: "550e8400-e29b-41d4-a716-446655440004",
    };

    await notification.notifyMemoryUpdate(proposal1);
    await notification.notifyMemoryUpdate(proposal2);

    await notification.clearAllNotifications();

    const remaining = await notification.getNotifications();
    assertEquals(remaining.length, 0);
  });
});

Deno.test("NotificationService: notifyApproval logs approval event", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    await notification.notifyApproval("proposal-id-123", "Test ILearning");
    await db.waitForFlush();

    const activities = db.instance.prepare(
      "SELECT action_type FROM activity WHERE action_type = 'memory.update.approved'",
    ).all() as Array<{ action_type: string }>;
    assertEquals(activities.length, 1);
  });
});

Deno.test("NotificationService: notifyRejection logs rejection event", async () => {
  await runNotificationTest(async ({ db, notification }) => {
    await notification.notifyRejection("proposal-id-456", "Not relevant");
    await db.waitForFlush();

    const activities = db.instance.prepare(
      "SELECT action_type, payload FROM activity WHERE action_type = 'memory.update.rejected'",
    ).all() as Array<{ action_type: string; payload: string }>;
    assertEquals(activities.length, 1);
    assertStringIncludes(activities[0].payload, "Not relevant");
  });
});

Deno.test("NotificationService: getPendingCount returns correct count", async () => {
  await runNotificationTest(async ({ notification }) => {
    assertEquals(await notification.getPendingCount(), 0);

    await notification.notifyMemoryUpdate(createTestProposal());
    assertEquals(await notification.getPendingCount(), 1);

    await notification.notifyMemoryUpdate({
      ...createTestProposal(),
      id: "550e8400-e29b-41d4-a716-446655440005",
    });
    assertEquals(await notification.getPendingCount(), 2);
  });
});
