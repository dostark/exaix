/**
 * @module KeyRoutingHelpersTest
 * @path packages/tui/tests/helpers/key_routing_helpers_test.ts
 * @description Regression tests for package-owned TUI pane management and key-routing helpers.
 */

import { assertEquals } from "@std/assert";
import { SplitDirection } from "@exaix/tui";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { splitPane } from "@exaix/tui/layout/pane_manager.ts";
import { testModeHandleKey } from "@exaix/tui/helpers/handle_key.ts";
import { prodHandleKey } from "@exaix/tui/helpers/prod_handle_key.ts";

function createViews() {
  return [
    { name: "PortalManagerView" },
    { name: "MonitorView" },
  ];
}

function createPanes() {
  const views = createViews();
  return [
    {
      id: "main",
      view: views[0],
      flexX: 0,
      flexY: 0,
      flexWidth: 1,
      flexHeight: 1,
      x: 0,
      y: 0,
      width: 80,
      height: 24,
      focused: true,
      maximized: false,
    },
  ];
}

Deno.test("key routing helpers: splitPane preserves package-owned pane logic", async () => {
  const panes = createPanes();
  const views = createViews();

  const result = await splitPane(
    panes,
    "main",
    views,
    SplitDirection.VERTICAL,
    () => Promise.resolve(),
  );

  assertEquals(panes.length, 2);
  assertEquals(result.activePaneId, "main");
  assertEquals(panes[0].width, 40);
  assertEquals(panes[1].x, 40);
});

Deno.test("key routing helpers: testModeHandleKey tabs between panes", async () => {
  const views = createViews();
  const panes = createPanes();
  await splitPane(panes, "main", views, SplitDirection.VERTICAL, () => Promise.resolve());

  const dashboard = {
    state: {
      showHelp: false,
      showNotifications: false,
      showViewPicker: false,
      showMemoryNotifications: false,
      selectedMemoryNotifIndex: 0,
    },
    activePaneId: "main",
    notificationService: {
      getNotifications: () => Promise.resolve([]),
      notify: () => Promise.resolve(),
      clearNotification: () => Promise.resolve(),
    },
    notify: () => Promise.resolve(),
  };

  const result = await testModeHandleKey(dashboard, KEYS.TAB, panes, views, { index: 0 });

  assertEquals(result, 0);
  assertEquals(dashboard.activePaneId, panes[1].id);
  assertEquals(panes[0].focused, false);
  assertEquals(panes[1].focused, true);
});

Deno.test("key routing helpers: prodHandleKey toggles notification panel", async () => {
  const views = createViews();
  const panes = createPanes();
  const state = {
    showHelp: false,
    showNotifications: false,
    showMemoryNotifications: false,
    selectedMemoryNotifIndex: 0,
  };

  const result = await prodHandleKey(KEYS.N, {
    prodState: state,
    panes,
    views,
    activePaneRef: { id: "main" },
    notificationService: {
      getNotifications: () => Promise.resolve([]),
      notify: () => Promise.resolve(),
      clearNotification: () => Promise.resolve(),
    },
    addNotification: () => Promise.resolve(),
    saveLayout: () => Promise.resolve(),
    restoreLayout: () => Promise.resolve(),
    resetToDefault: () => {},
  });

  assertEquals(result?.reRender, true);
  assertEquals(state.showNotifications, true);
});
