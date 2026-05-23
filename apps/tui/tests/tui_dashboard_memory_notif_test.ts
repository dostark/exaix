/**
 * @module TUIDashboardMemoryNotifTest
 * @path apps/tui/tests/tui_dashboard_memory_notif_test.ts
 * @description Verifies the TUI Dashboard's integration with memory update notifications,
 * ensuring real-time alerts when new agent knowledge is discovered.
 */

import { assertEquals } from "@std/assert";
import { MemoryOperation, MemoryScope } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { createTuiDashboardWithNotification } from "./dashboard_helper.ts";
import type { IProposalLearning } from "@exaix/schemas/memory_bank.ts";

Deno.test("TUI Dashboard + Memory: handles memory update notifications", async () => {
  const { dashboard, notificationService, cleanup } = await createTuiDashboardWithNotification();

  try {
    // 1. Add some notifications (info and memory_update_pending)
    await notificationService.notify("Normal info", "info");
    await notificationService.notifyMemoryUpdate({
      id: "prop-1",
      created_at: new Date().toISOString(),
      identity_id: "test-agent",
      operation: MemoryOperation.ADD,
      target_scope: MemoryScope.PROJECT,
      learning: { title: "ILearning 1", id: "l-1" } as Partial<IProposalLearning> as IProposalLearning,
      reason: "Testing 1",
      status: MemoryStatus.PENDING,
    });
    await notificationService.notifyMemoryUpdate({
      id: "prop-2",
      created_at: new Date().toISOString(),
      identity_id: "test-agent",
      operation: MemoryOperation.ADD,
      target_scope: MemoryScope.PROJECT,
      learning: { title: "ILearning 2", id: "l-2" } as Partial<IProposalLearning> as IProposalLearning,
      reason: "Testing 2",
      status: MemoryStatus.PENDING,
    });

    // 2. Toggle memory notification mode
    await dashboard.handleKey(KEYS.M);
    assertEquals(dashboard.state.showMemoryNotifications, true);
    assertEquals(dashboard.state.selectedMemoryNotifIndex, 0);

    // 3. Verify renderNotificationPanel filters for memory notifications
    const memoryLines = await dashboard.renderNotifications();
    const hasLearning1 = memoryLines.some((l: string) => l.includes("ILearning 1"));
    const hasLearning2 = memoryLines.some((l: string) => l.includes("ILearning 2"));
    const hasNormalInfo = memoryLines.some((l: string) => l.includes("Normal info"));

    assertEquals(hasLearning1, true);
    assertEquals(hasLearning2, true);
    assertEquals(hasNormalInfo, false);

    // 4. Test navigation
    await dashboard.handleKey(KEYS.DOWN);
    assertEquals(dashboard.state.selectedMemoryNotifIndex, 1);

    await dashboard.handleKey(KEYS.UP);
    assertEquals(dashboard.state.selectedMemoryNotifIndex, 0);

    // 5. Test Approval (placeholder in test mode)
    await dashboard.handleKey(KEYS.A);
    // In test mode it just notifies
    const allNotifs = await notificationService.getNotifications();
    const hasApprovalNotif = allNotifs.some((n) => n.message.includes(MemoryStatus.APPROVED) && n.type === "success");
    assertEquals(hasApprovalNotif, true);

    // 6. Test Rejection (placeholder in test mode)
    await dashboard.handleKey(KEYS.R);
    const allNotifsAfter = await notificationService.getNotifications();
    const hasRejNotif = allNotifsAfter.some((n) => n.message.includes(MemoryStatus.REJECTED) && n.type === "error");
    assertEquals(hasRejNotif, true);

    // 7. Toggle off
    await dashboard.handleKey(KEYS.M);
    assertEquals(dashboard.state.showMemoryNotifications, false);
  } finally {
    await cleanup();
  }
});
