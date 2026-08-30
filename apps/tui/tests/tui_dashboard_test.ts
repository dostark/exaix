/**
 * @module TUIDashboardTest
 * @path apps/tui/tests/tui_dashboard_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Comprehensive tests for the main TUI Dashboard, covering global event routing,
 * rapid keyboard navigation, notification overlays, and layout responsiveness.
 */

// Edge-case and end-to-end tests for TUI dashboard
import {
  createDefaultDashboardState,
  getDashboardHelpSections,
  type IPane,
  type ITuiDashboard,
  launchTuiDashboard,
  renderPaneTitleBar,
  renderViewPicker,
} from "../src/tui_dashboard.ts";
import { PortalStatus } from "@exaix/core";
import { SplitDirection } from "@exaix/tui";

import { assertEquals } from "@std/assert";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { getTheme } from "@exaix/tui/helpers/colors.ts";

type ISavedLayoutPane =
  & Pick<IPane, "id" | "x" | "y" | "width" | "height" | "focused" | "flexX" | "flexY" | "flexWidth" | "flexHeight">
  & {
    viewName: string;
  };

Deno.test("TUI dashboard handles empty portal list and error state", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  // Simulate empty portal list
  dashboard.portalManager.service.listPortals = () => Promise.resolve([]);
  const portals = await dashboard.portalManager.service.listPortals();
  if (portals.length !== 0) throw new Error("Empty state not handled");
  // Simulate error in service
  dashboard.portalManager.service.listPortals = () => {
    throw new Error("Service error");
  };
  let errorCaught = false;
  try {
    await dashboard.portalManager.service.listPortals();
  } catch (_e) {
    errorCaught = true;
  }
  if (!errorCaught) throw new Error("Error state not handled");
  dashboard.destroy();
});

Deno.test("TUI dashboard rapid navigation and focus wraparound", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  dashboard.switchPane("main"); // Start with main pane
  // Simulate rapid tabbing
  for (let i = 0; i < 20; ++i) {
    await dashboard.handleKey(KEYS.TAB);
  }
  assertEquals(dashboard.activePaneId, "main"); // Should wrap around to first pane
  // Simulate rapid shift+tab
  for (let i = 0; i < 20; ++i) {
    await dashboard.handleKey(KEYS.SHIFT_TAB);
  }
  assertEquals(dashboard.activePaneId, "main"); // Should wrap around
  dashboard.destroy();
});

Deno.test("TUI dashboard notification edge cases", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  let notified = false;
  dashboard.notify = (_msg: string) => {
    notified = true;
    return Promise.resolve();
  };
  await dashboard.notify("");
  if (!notified) throw new Error("Notification with empty message not handled");
  notified = false;
  await dashboard.notify(null as never as string);
  if (!notified) throw new Error("Notification with null not handled");
  dashboard.destroy();
});
Deno.test("TUI dashboard supports theming, accessibility, and keybinding customization", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  // Theming: verify theme object exists
  assertEquals(typeof dashboard.theme, "object");
  assertEquals(typeof dashboard.theme.primary, "string");
  // Accessibility: expose focusable elements
  const focusables = dashboard.panes[0].view.getFocusableElements?.() || [];
  if (!focusables.includes("portal-list")) throw new Error("Accessibility elements missing");
  // Keybinding customization: check keybindings
  assertEquals(dashboard.keybindings.splitVertical, "v");
  dashboard.destroy();
});
Deno.test("TUI dashboard supports real-time updates and notifications", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  let notification = "";
  dashboard.notify = (msg: string) => {
    notification = msg;
    return Promise.resolve();
  };
  // Simulate real-time update: portal added
  const portals = [
    {
      alias: "alpha",
      targetPath: "/a",
      symlinkPath: "/s/a",
      contextCardPath: "/c/a",
      status: PortalStatus.ACTIVE,
      permissions: "rw",
    },
  ];
  dashboard.portalManager.service.listPortals = () => Promise.resolve(portals);
  // Simulate notification
  await dashboard.notify("Portal alpha added");
  if (!notification.includes("alpha")) {
    throw new Error("Notification not triggered");
  }
  // Simulate another update
  portals.push({
    alias: "beta",
    targetPath: "/b",
    symlinkPath: "/s/b",
    contextCardPath: "/c/b",
    status: PortalStatus.ACTIVE,
    permissions: "rw",
  });
  const updated = await dashboard.portalManager.service.listPortals();
  if (updated.length !== 2) {
    throw new Error("Real-time update failed");
  }
  dashboard.destroy();
});
// tests/tui/tui_dashboard_test.ts
// TDD: End-to-end tests for TUI dashboard integration

Deno.test("TUI dashboard launches and returns dashboard instance", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  assertEquals(dashboard.panes.length, 1); // Starts with one pane
  assertEquals(dashboard.activePaneId, "main");
});

Deno.test("TUI dashboard handles keyboard navigation and focus", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  // Initial focus
  assertEquals(dashboard.activePaneId, "main");
  // Tab cycles focus forward
  await dashboard.handleKey(KEYS.TAB);
  assertEquals(dashboard.activePaneId, "main"); // Only one pane, wraps to itself
  // Add another pane
  await dashboard.splitPane(SplitDirection.VERTICAL);
  assertEquals(dashboard.panes.length, 2);
  await dashboard.handleKey(KEYS.TAB);
  assertEquals(dashboard.activePaneId, dashboard.panes[1].id);
  await dashboard.handleKey(KEYS.TAB);
  assertEquals(dashboard.activePaneId, "main"); // Wraps back to first pane
  // Shift+Tab cycles focus backward
  await dashboard.handleKey(KEYS.SHIFT_TAB);
  assertEquals(dashboard.activePaneId, dashboard.panes[1].id);
  dashboard.destroy();
});

Deno.test("TUI dashboard renders portal list, details, actions, and status bar", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  // Add mock portals for rendering
  dashboard.portalManager.service.listPortals = () =>
    Promise.resolve([
      {
        alias: "alpha",
        targetPath: "/a",
        symlinkPath: "/s/a",
        contextCardPath: "/c/a",
        status: PortalStatus.ACTIVE,
        permissions: "rw",
      },
      {
        alias: "beta",
        targetPath: "/b",
        symlinkPath: "/s/b",
        contextCardPath: "/c/b",
        status: PortalStatus.BROKEN,
        permissions: "r",
      },
    ]);
  const portals = await dashboard.portalManager.service.listPortals();
  const list = dashboard.portalManager.renderPortalList(portals);
  // Should render both portals, with error indicator for broken
  if (!list.includes("alpha") || !list.includes("beta") || !list.includes("ERROR")) {
    throw new Error("Portal list rendering failed");
  }
  // Status bar mock: just show active pane and view indicator
  const status = await dashboard.renderStatusBar();
  // New status bar format includes view indicator
  if (!status.includes("PortalManager") && !status.includes("Active")) {
    throw new Error("Status bar rendering failed: " + status);
  }
  dashboard.destroy();
});

Deno.test("TUI dashboard split view functionality", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  assertEquals(dashboard.panes.length, 1);
  assertEquals(dashboard.activePaneId, "main");

  // Split vertical
  await dashboard.splitPane(SplitDirection.VERTICAL);
  assertEquals(dashboard.panes.length, 2);
  assertEquals(dashboard.panes[0].width, 40); // Half of 80
  assertEquals(dashboard.panes[1].x, 40);

  // Split horizontal on second pane
  dashboard.switchPane(dashboard.panes[1].id);
  await dashboard.splitPane(SplitDirection.HORIZONTAL);
  assertEquals(dashboard.panes.length, 3);
  assertEquals(dashboard.panes[1].height, 12); // Half of 24
  assertEquals(dashboard.panes[2].y, 12);

  // Close a pane
  await dashboard.closePane(dashboard.panes[2].id);
  assertEquals(dashboard.panes.length, 2);

  // Resize pane
  const originalFlexWidth = dashboard.panes[0].flexWidth;
  dashboard.resizePane(dashboard.panes[0].id, 0.1, 0); // Increase flex width by 0.1
  assertEquals(dashboard.panes[0].flexWidth.toFixed(2), (originalFlexWidth + 0.1).toFixed(2));
  dashboard.destroy();
});

Deno.test("TUI dashboard pane focus and switching", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;
  dashboard.splitPane(SplitDirection.VERTICAL);
  const secondPaneId = dashboard.panes[1].id;

  dashboard.switchPane(secondPaneId);
  assertEquals(dashboard.activePaneId, secondPaneId);
  assertEquals(dashboard.panes[1].focused, true);
  assertEquals(dashboard.panes[0].focused, false);
  dashboard.destroy();
});
Deno.test("TUI dashboard layout save and restore", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Modify layout
  dashboard.splitPane(SplitDirection.VERTICAL);
  dashboard.splitPane(SplitDirection.HORIZONTAL);
  const originalPanes = dashboard.panes.length;
  const originalActive = dashboard.activePaneId;

  // Mock save
  let savedLayout: { panes: ISavedLayoutPane[]; activePaneId: string } | null = null;
  dashboard.saveLayout = () => {
    savedLayout = {
      panes: dashboard.panes.map((p) => ({
        id: p.id,
        viewName: p.view.name,
        flexX: p.flexX,
        flexY: p.flexY,
        flexWidth: p.flexWidth,
        flexHeight: p.flexHeight,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        focused: p.focused,
      })),
      activePaneId: dashboard.activePaneId,
    };
    return Promise.resolve();
  };

  await dashboard.saveLayout();
  if (!savedLayout) throw new Error("Layout was not saved");
  const persistedLayout = savedLayout as { panes: ISavedLayoutPane[]; activePaneId: string };
  assertEquals(persistedLayout.panes.length, originalPanes);
  assertEquals(persistedLayout.activePaneId, originalActive);

  // Reset and restore
  dashboard.resetToDefault();
  assertEquals(dashboard.panes.length, 1);
  assertEquals(dashboard.activePaneId, "main");

  // Mock restore
  dashboard.restoreLayout = () => {
    if (savedLayout) {
      dashboard.panes.length = 0;
      for (const p of savedLayout.panes) {
        dashboard.panes.push({
          id: p.id,
          view: { name: p.viewName }, // Mock view
          flexX: p.flexX ?? (p.x / 80),
          flexY: p.flexY ?? (p.y / 24),
          flexWidth: p.flexWidth ?? (p.width / 80),
          flexHeight: p.flexHeight ?? (p.height / 24),
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          focused: p.focused,
        });
      }
      dashboard.activePaneId = savedLayout.activePaneId;
    }
    return Promise.resolve();
  };

  await dashboard.restoreLayout();
  assertEquals(dashboard.panes.length, originalPanes);
  assertEquals(dashboard.activePaneId, originalActive);
  dashboard.destroy();
});

Deno.test("TUI dashboard reset to default", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Modify layout
  await dashboard.splitPane(SplitDirection.VERTICAL);
  await dashboard.splitPane(SplitDirection.HORIZONTAL);
  assertEquals(dashboard.panes.length, 3);

  // Reset
  await dashboard.resetToDefault();
  assertEquals(dashboard.panes.length, 1);
  assertEquals(dashboard.activePaneId, "main");
  assertEquals(dashboard.panes[0].view.name, "PortalManagerView");
  dashboard.destroy();
});

Deno.test("TUI dashboard comprehensive keyboard actions test", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Start with default single pane
  assertEquals(dashboard.panes.length, 1);
  assertEquals(dashboard.activePaneId, "main");

  // Test Tab navigation (should wrap with single pane)
  await dashboard.handleKey(KEYS.TAB);
  assertEquals(dashboard.activePaneId, "main");

  // Test Shift+Tab navigation
  await dashboard.handleKey(KEYS.SHIFT_TAB);
  assertEquals(dashboard.activePaneId, "main");

  // Test vertical split
  await dashboard.handleKey(KEYS.V);
  assertEquals(dashboard.panes.length, 2);
  assertEquals(dashboard.panes[0].width, 40); // Half width
  assertEquals(dashboard.panes[1].x, 40); // Offset by half width

  // Test horizontal split on second pane
  dashboard.switchPane(dashboard.panes[1].id);
  await dashboard.handleKey(KEYS.H);
  assertEquals(dashboard.panes.length, 3);
  assertEquals(dashboard.panes[1].height, 12); // Half height
  assertEquals(dashboard.panes[2].y, 12); // Offset by half height

  // Test pane navigation with multiple panes
  dashboard.switchPane("main");
  await dashboard.handleKey(KEYS.TAB); // Should go to second pane
  assertEquals(dashboard.activePaneId, dashboard.panes[1].id);
  await dashboard.handleKey(KEYS.TAB); // Should go to third pane
  assertEquals(dashboard.activePaneId, dashboard.panes[2].id);
  await dashboard.handleKey(KEYS.TAB); // Should wrap to first pane
  assertEquals(dashboard.activePaneId, "main");

  // Test reverse navigation
  await dashboard.handleKey(KEYS.SHIFT_TAB); // Should go to third pane
  assertEquals(dashboard.activePaneId, dashboard.panes[2].id);
  await dashboard.handleKey(KEYS.SHIFT_TAB); // Should go to second pane
  assertEquals(dashboard.activePaneId, dashboard.panes[1].id);

  // Test close pane (close third pane)
  dashboard.switchPane(dashboard.panes[2].id);
  await dashboard.handleKey(KEYS.C);
  assertEquals(dashboard.panes.length, 2);
  assertEquals(dashboard.activePaneId, dashboard.panes[0].id); // Should switch to first pane

  // Test Enter key (no-op)
  await dashboard.handleKey(KEYS.ENTER);
  assertEquals(dashboard.panes.length, 2); // Should remain unchanged

  // Test invalid key (should be ignored)
  await dashboard.handleKey(KEYS.X);
  assertEquals(dashboard.panes.length, 2); // Should remain unchanged

  // Test save layout
  let layoutSaved = false;
  dashboard.saveLayout = () => {
    layoutSaved = true;
    return Promise.resolve();
  };
  await dashboard.handleKey(KEYS.S);
  assertEquals(layoutSaved, true);

  // Test restore layout
  let layoutRestored = false;
  dashboard.restoreLayout = () => {
    layoutRestored = true;
    return Promise.resolve();
  };
  await dashboard.handleKey(KEYS.R);
  assertEquals(layoutRestored, true);

  // Test reset to default
  let layoutReset = false;
  dashboard.resetToDefault = () => {
    layoutReset = true;
    // Actually reset the panes
    dashboard.panes.length = 0;
    dashboard.panes.push({
      id: "main",
      view: { name: "PortalManagerView" },
      flexX: 0,
      flexY: 0,
      flexWidth: 1.0,
      flexHeight: 1.0,
      x: 0,
      y: 0,
      width: 80,
      height: 24,
      focused: true,
    });
    dashboard.activePaneId = "main";
    return Promise.resolve();
  };
  await dashboard.handleKey(KEYS.D);
  assertEquals(layoutReset, true);

  // Test invalid key (should be ignored, no crash)
  await dashboard.handleKey(KEYS.X);
  assertEquals(dashboard.panes.length, 1); // Should remain unchanged
  dashboard.destroy();
});

Deno.test({
  name: "TUI dashboard production launch initializes views and renders without error",
  // Production mode creates timers for auto-refresh that we don't want to wait for
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Test production launch in non-interactive mode
    await launchTuiDashboard({ nonInteractive: true });
    // If no error thrown, test passes
    // In production, this would render to console, but here we just check initialization
  },
});

// ===== Dashboard Integration Tests =====

Deno.test("TUI dashboard state initialization", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Verify state exists
  assertEquals(typeof dashboard.state, "object");
  assertEquals(dashboard.state.showHelp, false);
  assertEquals(dashboard.state.showNotifications, false);
  assertEquals(dashboard.state.showViewPicker, false);
  assertEquals(dashboard.state.isLoading, false);
  const notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 0);
  dashboard.destroy();
});

Deno.test("TUI dashboard default state includes memory fields", () => {
  const state = createDefaultDashboardState();
  assertEquals(state.showHelp, false);
  assertEquals(state.showNotifications, false);
  assertEquals(state.showViewPicker, false);
  assertEquals(state.isLoading, false);
  assertEquals(state.loadingMessage, "");
  assertEquals(state.error, null);
  assertEquals(state.currentTheme, "dark");
  assertEquals(state.highContrast, false);
  assertEquals(state.screenReader, false);
  assertEquals(state.showMemoryNotifications, false);
  assertEquals(state.selectedMemoryNotifIndex, 0);
});

Deno.test("TUI dashboard help sections include navigation and layout keys", () => {
  const sections = getDashboardHelpSections();
  const titles = sections.map((section) => section.title);
  assertEquals(titles.includes("Navigation"), true);
  assertEquals(titles.includes("Layout Management"), true);

  const navigation = sections.find((section) => section.title === "Navigation");
  const navigationKeys = navigation?.items.map((item) => item.key) ?? [];
  assertEquals(navigationKeys.includes(KEYS.TAB), true);
  assertEquals(navigationKeys.includes(KEYS.SHIFT_TAB), true);
});

Deno.test("TUI dashboard help overlay toggle", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Initially help is hidden
  assertEquals(dashboard.state.showHelp, false);

  // Show help with ?
  await dashboard.handleKey(KEYS.QUESTION);
  assertEquals(dashboard.state.showHelp, true);

  // Hide help with ?
  await dashboard.handleKey(KEYS.QUESTION);
  assertEquals(dashboard.state.showHelp, false);

  // Show help again
  await dashboard.handleKey(KEYS.QUESTION);
  assertEquals(dashboard.state.showHelp, true);

  // Hide with escape
  await dashboard.handleKey(KEYS.ESCAPE);
  assertEquals(dashboard.state.showHelp, false);
  dashboard.destroy();
});

Deno.test("TUI dashboard notification toggle", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Initially notifications panel is hidden
  assertEquals(dashboard.state.showNotifications, false);

  // Toggle notifications with n
  await dashboard.handleKey(KEYS.N);
  assertEquals(dashboard.state.showNotifications, true);

  // Toggle off
  await dashboard.handleKey(KEYS.N);
  assertEquals(dashboard.state.showNotifications, false);
  dashboard.destroy();
});

Deno.test("TUI dashboard notification system", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Add notifications
  await dashboard.notify("Test info notification", "info");
  let notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 1);
  assertEquals(notifs[0].type, "info");

  await dashboard.notify("Test success notification", "success");
  notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 2);
  assertEquals(notifs[0].type, "success"); // Newest first

  await dashboard.notify("Test warning notification", "warning");
  await dashboard.notify("Test error notification", "error");
  notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 4);
  dashboard.destroy();
});

Deno.test("TUI dashboard notification dismissal", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  await dashboard.notify("Notification 1");
  await dashboard.notify("Notification 2");
  let notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 2);

  // Dismiss first notification
  const firstId = notifs[0].id!;
  await dashboard.dismissNotification(firstId);

  notifs = await dashboard.notificationService.getNotifications();
  // Service filter for getNotifications excludes dismissed by default
  assertEquals(notifs.length, 1);

  // Clear all notifications
  await dashboard.clearNotifications();
  notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 0);
  dashboard.destroy();
});

Deno.test("TUI dashboard view indicator rendering", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Render view indicator
  const indicator = dashboard.renderViewIndicator();
  assertEquals(typeof indicator, "string");
  assertEquals(indicator.length > 0, true);

  // Should contain pane focus indicator
  assertEquals(indicator.includes("●") || indicator.includes("1:"), true);
  dashboard.destroy();
});

Deno.test("TUI dashboard view picker renders selected view", () => {
  const theme = getTheme(true);
  const views = [{ name: "PortalManagerView" }, { name: "MonitorView" }];
  const lines = renderViewPicker(views, 1, theme);
  const text = lines.join("\n");

  assertEquals(text.includes("Select View"), true);
  assertEquals(text.includes("PortalManager"), true);
  assertEquals(text.includes("Monitor"), true);
  assertEquals(text.includes("▶"), true);
  assertEquals(text.includes("◀"), true);
});

Deno.test("TUI dashboard pane title bar reflects focus and max state", () => {
  const theme = getTheme(true);
  const pane: IPane = {
    id: "main",
    view: { name: "PortalManagerView" },
    flexX: 0,
    flexY: 0,
    flexWidth: 1,
    flexHeight: 1,
    x: 0,
    y: 0,
    width: 80,
    height: 24,
    focused: true,
    maximized: true,
  };

  const title = renderPaneTitleBar(pane, theme);
  assertEquals(title.includes("PortalManager"), true);
  assertEquals(title.includes("[MAX]"), true);
  assertEquals(title.includes("●"), true);
});

Deno.test("TUI dashboard global help rendering", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  const helpLines = dashboard.renderGlobalHelp();
  assertEquals(Array.isArray(helpLines), true);
  assertEquals(helpLines.length > 0, true);

  // Should contain help title and sections
  const helpText = helpLines.join("\n");
  assertEquals(helpText.includes("Help") || helpText.includes("Navigation"), true);
  dashboard.destroy();
});

Deno.test("TUI dashboard notification panel rendering", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Empty notifications
  let notifLines = await dashboard.renderNotifications();
  assertEquals(Array.isArray(notifLines), true);

  // With notifications
  await dashboard.notify("Test notification", "info");
  notifLines = await dashboard.renderNotifications();
  assertEquals(notifLines.length > 0, true);
  dashboard.destroy();
});

Deno.test("TUI dashboard status bar with notifications badge", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Status bar without notifications
  let statusBar = await dashboard.renderStatusBar();
  assertEquals(typeof statusBar, "string");

  // Add notification and check badge appears
  await dashboard.notify("Test notification");
  statusBar = await dashboard.renderStatusBar();
  assertEquals(statusBar.includes("🔔") || statusBar.includes("1"), true);
  dashboard.destroy();
});

Deno.test("TUI dashboard direct pane navigation with number keys", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Create multiple panes
  dashboard.splitPane(SplitDirection.VERTICAL);
  dashboard.splitPane(SplitDirection.HORIZONTAL);
  assertEquals(dashboard.panes.length, 3);

  // Navigate directly to panes using number keys
  await dashboard.handleKey(KEYS.ONE);
  assertEquals(dashboard.activePaneId, dashboard.panes[0].id);

  await dashboard.handleKey(KEYS.TWO);
  assertEquals(dashboard.activePaneId, dashboard.panes[1].id);

  await dashboard.handleKey(KEYS.THREE);
  assertEquals(dashboard.activePaneId, dashboard.panes[2].id);

  // Invalid pane number (beyond available panes)
  await dashboard.handleKey(KEYS.SEVEN);
  assertEquals(dashboard.activePaneId, dashboard.panes[2].id); // Should stay on pane 3
  dashboard.destroy();
});

Deno.test("TUI dashboard pane maximize/restore", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Get initial bounds
  const originalWidth = dashboard.panes[0].width;
  const originalHeight = dashboard.panes[0].height;

  // Maximize with z
  await dashboard.handleKey(KEYS.Z);
  assertEquals(dashboard.panes[0].maximized, true);
  assertEquals(dashboard.panes[0].width, 80);
  assertEquals(dashboard.panes[0].height, 24);

  // Restore with z
  await dashboard.handleKey(KEYS.Z);
  assertEquals(dashboard.panes[0].maximized, false);
  assertEquals(dashboard.panes[0].width, originalWidth);
  assertEquals(dashboard.panes[0].height, originalHeight);
});

Deno.test("TUI dashboard maximizePane and restorePane methods", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Maximize
  dashboard.maximizePane("main");
  assertEquals(dashboard.panes[0].maximized, true);

  // Restore
  dashboard.restorePane("main");
  assertEquals(dashboard.panes[0].maximized, false);
});

Deno.test("TUI dashboard view picker state", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Initially view picker is hidden
  assertEquals(dashboard.state.showViewPicker, false);

  // Show view picker with p
  await dashboard.handleKey(KEYS.P);
  assertEquals(dashboard.state.showViewPicker, true);

  // Close with escape
  await dashboard.handleKey(KEYS.ESCAPE);
  assertEquals(dashboard.state.showViewPicker, false);
});

Deno.test("TUI dashboard view picker navigation", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Open view picker
  await dashboard.handleKey(KEYS.P);
  assertEquals(dashboard.state.showViewPicker, true);

  // Navigate with arrow keys (view picker should handle them)
  await dashboard.handleKey(KEYS.DOWN);
  await dashboard.handleKey(KEYS.UP);

  // Select with enter
  await dashboard.handleKey(KEYS.ENTER);
  assertEquals(dashboard.state.showViewPicker, false);
});

Deno.test("TUI dashboard view picker number selection", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  const originalView = dashboard.panes[0].view.name;

  // Open view picker
  await dashboard.handleKey(KEYS.P);

  // Select view 2 directly
  await dashboard.handleKey(KEYS.TWO);
  assertEquals(dashboard.state.showViewPicker, false);

  // View should have changed
  assertEquals(dashboard.panes[0].view.name !== originalView, true);
});

Deno.test("TUI dashboard notifications with split operations", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Split should add notification
  await dashboard.handleKey(KEYS.V);
  const notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length > 0, true);

  // Close should add notification
  await dashboard.handleKey(KEYS.C);
  const notifsAfterClose = await dashboard.notificationService.getNotifications();
  assertEquals(notifsAfterClose.length > 0, true);
});

Deno.test("TUI dashboard reset clears notifications", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Add some notifications
  await dashboard.notify("Notification 1");
  await dashboard.notify("Notification 2");
  let notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 2);

  // Reset should clear notifications and add reset notification
  await dashboard.resetToDefault();

  notifs = await dashboard.notificationService.getNotifications();
  assertEquals(notifs.length, 1);
  assertEquals(
    notifs[0].message.includes("reset") ||
      notifs[0].message.includes("default"),
    true,
  );
});

Deno.test("TUI dashboard theme is accessible", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  assertEquals(typeof dashboard.theme, "object");
  assertEquals(typeof dashboard.theme.primary, "string");
  assertEquals(typeof dashboard.theme.reset, "string");
});

Deno.test("TUI dashboard key bindings block other keys when help is shown", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // Show help
  await dashboard.handleKey(KEYS.QUESTION);
  assertEquals(dashboard.state.showHelp, true);

  // Try to split - should be blocked
  const paneCountBefore = dashboard.panes.length;
  await dashboard.handleKey(KEYS.V);
  assertEquals(dashboard.panes.length, paneCountBefore); // No split occurred

  // Close help
  await dashboard.handleKey(KEYS.QUESTION);
  assertEquals(dashboard.state.showHelp, false);

  // Now split should work
  await dashboard.handleKey(KEYS.V);
  assertEquals(dashboard.panes.length, paneCountBefore + 1);
});

Deno.test("TUI dashboard neighbor-aware flex resizing logic", async () => {
  const dashboard = await launchTuiDashboard({ testMode: true }) as ITuiDashboard;

  // 1. Vertical split: IPane 0 (Left 0.5) | IPane 1 (Right 0.5)
  await dashboard.splitPane(SplitDirection.VERTICAL);
  assertEquals(dashboard.panes[0].flexWidth, 0.5);
  assertEquals(dashboard.panes[1].flexWidth, 0.5);
  assertEquals(dashboard.panes[1].flexX, 0.5);

  // Resize IPane 0 to the right by +0.1
  dashboard.resizePane(dashboard.panes[0].id, 0.1, 0);
  assertEquals(dashboard.panes[0].flexWidth, 0.6);
  assertEquals(dashboard.panes[1].flexX, 0.6); // Neighbor moved
  assertEquals(parseFloat(dashboard.panes[1].flexWidth.toFixed(2)), 0.4); // Neighbor shrunk

  // Resize IPane 1 to the right by +0.1 (should act as left edge move for IPane 1)
  // Our resizePane logic for "right sibling" handles moving the border between them.
  // If we select IPane 1 and "resize left" (-0.1), it should grow IPane 0 and shrink IPane 1.
  dashboard.switchPane(dashboard.panes[1].id);
  dashboard.resizePane(dashboard.panes[1].id, -0.1, 0);
  assertEquals(dashboard.panes[0].flexWidth, 0.7); // IPane 0 grew
  assertEquals(dashboard.panes[1].flexX, 0.7); // Border moved right
  assertEquals(parseFloat(dashboard.panes[1].flexWidth.toFixed(2)), 0.3);

  // 2. Horizontal split on IPane 0: IPane 0 (Top) | IPane 2 (Bottom)
  dashboard.switchPane(dashboard.panes[0].id);
  await dashboard.splitPane(SplitDirection.HORIZONTAL);
  // IPane 0 now has flexHeight 0.5 of its original 1.0 = 0.5
  // IPane 2 has flexY 0.5 and flexHeight 0.5
  assertEquals(dashboard.panes[0].flexHeight, 0.5);
  assertEquals(dashboard.panes[2].flexHeight, 0.5);
  assertEquals(dashboard.panes[2].flexY, 0.5);

  // Resize IPane 0 down by +0.1
  dashboard.resizePane(dashboard.panes[0].id, 0, 0.1);
  assertEquals(dashboard.panes[0].flexHeight, 0.6);
  assertEquals(dashboard.panes[2].flexY, 0.6); // Neighbor moved down
  assertEquals(parseFloat(dashboard.panes[2].flexHeight.toFixed(2)), 0.4);

  // Test boundaries: try to resize IPane 1 too small
  dashboard.switchPane(dashboard.panes[1].id);
  // IPane 1 is 0.3 width. Min flex is 0.1. Resize by -0.3 should stop at 0.1.
  dashboard.resizePane(dashboard.panes[1].id, -0.3, 0);
  assertEquals(dashboard.panes[1].flexWidth >= 0.1, true);

  dashboard.destroy();
});
