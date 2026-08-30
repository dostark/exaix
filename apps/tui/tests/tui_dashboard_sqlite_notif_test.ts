/**
 * @module TUIDashboardSQLiteNotifTest
 * @path apps/tui/tests/tui_dashboard_sqlite_notif_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the integration between the TUI Dashboard and the SQLite-backed
 * notification service, ensuring events are correctly polled and displayed.
 */

import { assertEquals } from "@std/assert";
import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { createTuiDashboardWithNotification } from "./dashboard_helper.ts";

Deno.test("TUI Dashboard + SQLite: handles notification service integration", async () => {
  const { dashboard, notificationService, cleanup } = await createTuiDashboardWithNotification();

  try {
    // Verifies NotificationService is integrated with the dashboard.
    assertEquals(dashboard.notificationService, notificationService);

    // Verify in-memory notifications are gone
    // assertEquals((dashboard.state as { notifications?: any }).notifications, undefined); // Type check confirms this

    // Verify async rendering of notifications
    await notificationService.notifyMemoryUpdate({
      id: "prop-1",
      created_at: new Date().toISOString(),
      identity_id: "test-agent",
      operation: MemoryOperation.ADD,
      target_scope: MemoryScope.PROJECT,
      learning: {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        source: MemoryBankSource.USER,
        scope: MemoryScope.PROJECT,
        title: "Test ILearning",
        description: "Test description",
        category: LearningCategory.INSIGHT,
        tags: ["test"],
        confidence: ConfidenceAssessmentLevel.HIGH,
      },
      reason: "Testing",
      status: MemoryStatus.PENDING,
    });

    const notifLines = await dashboard.renderNotifications();
    const hasNotif = notifLines.some((l: string) => l.includes("Test ILearning"));
    assertEquals(hasNotif, true);

    // Verify async status bar with count from DB
    const statusBar = await dashboard.renderStatusBar();
    assertEquals(statusBar.includes("🔔1"), true);

    // Verify async dismissal
    await dashboard.dismissNotification("prop-1");
    const countAfterDismiss = await notificationService.getPendingCount();
    assertEquals(countAfterDismiss, 0);

    const statusBarEmpty = await dashboard.renderStatusBar();
    assertEquals(statusBarEmpty.includes("🔔"), false);
  } finally {
    await cleanup();
  }
});
