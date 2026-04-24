/**
 * @module TUIDashboardSQLiteNotifTest
 * @path tests/tui/tui_dashboard_sqlite_notif_test.ts
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
} from "../../src/shared/enums.ts";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";
import { createTuiDashboardWithNotification } from "./dashboard_helper.ts";

Deno.test("TUI Dashboard + SQLite: handles notification service integration", async () => {
  const { dashboard, notificationService, cleanup } = await createTuiDashboardWithNotification();

  try {
    // Phase 1: Verify NotificationService is integrated
    // This will initially fail if launchTuiDashboard doesn't accept or store the service
    assertEquals(dashboard.notificationService, notificationService);

    // Phase 1: Verify in-memory notifications are gone
    // assertEquals((dashboard.state as { notifications?: any }).notifications, undefined); // Type check confirms this

    // Phase 1: Verify async rendering of notifications
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

    // Phase 1: Verify async status bar with count from DB
    const statusBar = await dashboard.renderStatusBar();
    assertEquals(statusBar.includes("🔔1"), true);

    // Phase 1: Verify async dismissal
    await dashboard.dismissNotification("prop-1");
    const countAfterDismiss = await notificationService.getPendingCount();
    assertEquals(countAfterDismiss, 0);

    const statusBarEmpty = await dashboard.renderStatusBar();
    assertEquals(statusBarEmpty.includes("🔔"), false);
  } finally {
    await cleanup();
  }
});
