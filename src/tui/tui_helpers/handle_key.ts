/**
 * @module TuiHandleKey
 * @path src/tui/tui_helpers/handle_key.ts
 * @description Centralized key handling for the TUI dashboard, managing overlays, state toggles, and pane navigation.
 * @architectural-layer TUI
 * @related-files [src/tui/tui_dashboard.ts, src/tui/tui_helpers/prod_handle_key.ts]
 */

import type { IPane, ITuiDashboard, ITuiView } from "../tui_dashboard.ts";
import { closePane, maximizePane, resizePane, splitPane } from "../dashboard/pane_manager.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { SplitDirection } from "@exaix/tui";

// ===== Helper Functions =====

/**
 * Handle overlay and picker keys
 */
async function handleOverlayKeys(
  dashboard: ITuiDashboard,
  key: string,
  panes: IPane[],
  views: ITuiView[],
  viewPickerRef: { index: number },
): Promise<number | null> {
  if (dashboard.state.showHelp) {
    return await dashboard.handleHelpOverlay?.(dashboard, key, panes) ?? 0;
  }

  if (dashboard.state.showMemoryNotifications) {
    return await dashboard.handleMemoryNotifications?.(dashboard, key, panes, dashboard.notificationService) ??
      0;
  }

  if (dashboard.state.showViewPicker) {
    const idx = dashboard.handleViewPicker?.(dashboard, key, views, panes, viewPickerRef) ?? -1;
    return idx;
  }

  return null;
}

/**
 * Handle state toggle keys
 */
function handleStateToggleKeys(dashboard: ITuiDashboard, key: string, viewPickerRef: { index: number }): boolean {
  const k = key.toLowerCase();

  if (k === KEYS.QUESTION || k === KEYS.F1) {
    dashboard.state.showHelp = true;
    return true;
  }

  if (k === KEYS.P) {
    dashboard.state.showViewPicker = true;
    viewPickerRef.index = 0;
    return true;
  }

  if (key === KEYS.N) {
    dashboard.state.showNotifications = !dashboard.state.showNotifications;
    return true;
  }

  if (key === KEYS.M) {
    dashboard.state.showMemoryNotifications = !dashboard.state.showMemoryNotifications;
    dashboard.state.selectedMemoryNotifIndex = 0;
    return true;
  }

  return false;
}

/**
 * Handle pane navigation keys
 */
function handlePaneNavigationKeys(
  dashboard: ITuiDashboard,
  key: string,
  panes: IPane[],
): boolean {
  const k = key.toLowerCase();

  if (k === KEYS.TAB) {
    const currentIndex = panes.findIndex((p) => p.id === dashboard.activePaneId);
    // Debug: ensure panes and activePaneId are as expected during tests
    const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
    if (denoEnv?.env.get("EXA_TEST_LOG_TAB_DEBUG") === "1") {
      console.debug(
        "[TUI][DEBUG] TAB pressed: panes=",
        panes.map((p) => p.id),
        "active=",
        dashboard.activePaneId,
        "currentIndex=",
        currentIndex,
      );
    }
    const nextIndex = (currentIndex + 1) % panes.length;
    dashboard.activePaneId = panes[nextIndex].id;
    panes.forEach((p) => p.focused = false);
    panes[nextIndex].focused = true;
    return true;
  }

  if (k === KEYS.SHIFT_TAB.toLowerCase()) {
    const currentIndex = panes.findIndex((p) => p.id === dashboard.activePaneId);
    const prevIndex = (currentIndex - 1 + panes.length) % panes.length;
    dashboard.activePaneId = panes[prevIndex].id;
    panes.forEach((p) => p.focused = false);
    panes[prevIndex].focused = true;
    return true;
  }

  if (key >= KEYS.ONE && key <= KEYS.SEVEN) {
    // Direct pane navigation
    const idx = parseInt(key) - 1;
    if (idx < panes.length) {
      panes.forEach((p) => p.focused = false);
      panes[idx].focused = true;
      dashboard.activePaneId = panes[idx].id;
    }
    return true;
  }

  return false;
}

/**
 * Handle pane management keys (split, close, maximize)
 */
async function handlePaneManagementKeys(
  dashboard: ITuiDashboard,
  key: string,
  panes: IPane[],
  views: ITuiView[],
): Promise<boolean> {
  const k = key.toLowerCase();

  if (k === KEYS.V) { // Split vertical
    const res = await splitPane(
      panes,
      dashboard.activePaneId,
      views,
      SplitDirection.VERTICAL,
      dashboard.notify.bind(dashboard),
    );
    dashboard.activePaneId = res.activePaneId;
    return true;
  }

  if (k === KEYS.H) { // Split horizontal
    const res = await splitPane(
      panes,
      dashboard.activePaneId,
      views,
      SplitDirection.HORIZONTAL,
      dashboard.notify.bind(dashboard),
    );
    dashboard.activePaneId = res.activePaneId;
    return true;
  }

  if (k === KEYS.C) { // Close pane
    const result = await closePane(
      panes,
      dashboard.activePaneId,
      dashboard.activePaneId,
      dashboard.notify.bind(dashboard),
    );
    dashboard.activePaneId = result.activePaneId;
    return true;
  }

  if (k === KEYS.Z) { // Maximize/restore
    maximizePane(panes, dashboard.activePaneId, dashboard.notify.bind(dashboard));
    return true;
  }

  return false;
}

/**
 * Handle layout operation keys (resize, save, restore)
 */
async function handleLayoutOperationKeys(dashboard: ITuiDashboard, key: string, panes: IPane[]): Promise<boolean> {
  const k = key.toLowerCase();

  if (k === KEYS.CTRL_LEFT.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, -0.05, 0);
    return true;
  }

  if (k === KEYS.CTRL_RIGHT.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, 0.05, 0);
    return true;
  }

  if (k === KEYS.CTRL_UP.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, 0, -0.05);
    return true;
  }

  if (k === KEYS.CTRL_DOWN.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, 0, 0.05);
    return true;
  }

  if (k === KEYS.S) { // Save layout
    if (dashboard.saveLayout) await dashboard.saveLayout();
    return true;
  }

  if (k === KEYS.R) { // Restore layout
    if (dashboard.restoreLayout) await dashboard.restoreLayout();
    return true;
  }

  if (k === KEYS.D) { // Reset to default
    if (dashboard.resetToDefault) await dashboard.resetToDefault();
    return true;
  }

  return false;
}

export async function testModeHandleKey(
  dashboard: ITuiDashboard,
  key: string,
  panes: IPane[],
  views: ITuiView[],
  viewPickerRef: { index: number },
): Promise<number> {
  // 1. Handle overlays and pickers
  const overlayResult = await handleOverlayKeys(dashboard, key, panes, views, viewPickerRef);
  if (overlayResult !== null) return overlayResult;

  // 2. Handle state toggles
  if (handleStateToggleKeys(dashboard, key, viewPickerRef)) return 0;

  // 3. Handle pane navigation
  if (handlePaneNavigationKeys(dashboard, key, panes)) return 0;

  // 4. Handle pane management
  if (await handlePaneManagementKeys(dashboard, key, panes, views)) return 0;

  // 5. Handle layout operations
  if (await handleLayoutOperationKeys(dashboard, key, panes)) return 0;

  // 6. Handle special keys
  if (key === KEYS.ENTER) {
    // No-op for test
    return 0;
  }

  // Ensure activePaneId reflects focused pane (robustness against variant code paths)
  const focusedPane = panes.find((p) => p.focused);
  if (focusedPane) {
    dashboard.activePaneId = focusedPane.id;
  }

  // Allow any microtasks to settle before returning (stabilize state for tests)
  await Promise.resolve();

  return panes.findIndex((p) => p.id === dashboard.activePaneId);
}
