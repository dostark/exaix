/**
 * @module TuiHandleKey
 * @path packages/tui/src/helpers/handle_key.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned test-mode key routing for the TUI dashboard.
 */

import { SplitDirection } from "../types/enums.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import {
  closePane,
  type IPaneLike,
  type ITuiViewLike,
  maximizePane,
  resizePane,
  splitPane,
} from "@exaix/tui/layout/pane_manager.ts";

export interface ITestModeDashboardState {
  showHelp: boolean;
  showNotifications: boolean;
  showViewPicker: boolean;
  showMemoryNotifications: boolean;
  selectedMemoryNotifIndex: number;
}

export interface ITestModeNotificationServiceLike {
  getNotifications(): Promise<readonly unknown[]>;
  notify(message: string, type?: string): Promise<void>;
  clearNotification(id: string): Promise<void>;
}

export interface ITestModeDashboardCallbackHost {
  state: ITestModeDashboardState;
  activePaneId: string;
}

export interface ITestModeMemoryDashboardCallbackHost extends ITestModeDashboardCallbackHost {
  approveMemoryUpdate(proposalId: string): Promise<void>;
  rejectMemoryUpdate(proposalId: string): Promise<void>;
}

type HelpOverlayHandler = {
  bivarianceHack(self: ITestModeDashboardCallbackHost, key: string, panes: IPaneLike[]): Promise<number> | number;
}["bivarianceHack"];

type ViewPickerHandler = {
  bivarianceHack(
    self: ITestModeDashboardCallbackHost,
    key: string,
    views: ITuiViewLike[],
    panes: IPaneLike[],
    viewPickerIndexRef: { index: number },
  ): number;
}["bivarianceHack"];

type MemoryNotificationsHandler = {
  bivarianceHack(
    self: ITestModeMemoryDashboardCallbackHost,
    key: string,
    panes: IPaneLike[],
    notificationService: ITestModeNotificationServiceLike,
  ): Promise<number> | number;
}["bivarianceHack"];

export interface ITestModeDashboard {
  state: ITestModeDashboardState;
  activePaneId: string;
  notificationService?: ITestModeNotificationServiceLike;
  notify(message: string, type?: string): Promise<void>;
  handleHelpOverlay?: HelpOverlayHandler;
  handleViewPicker?: ViewPickerHandler;
  handleMemoryNotifications?: MemoryNotificationsHandler;
  saveLayout?: () => Promise<void> | void;
  restoreLayout?: () => Promise<void> | void;
  resetToDefault?: () => Promise<void> | void;
}

function hasMemoryNotificationContext(
  dashboard: ITestModeDashboard,
): dashboard is ITestModeDashboard & ITestModeMemoryDashboardCallbackHost & {
  notificationService: ITestModeNotificationServiceLike;
} {
  return typeof (dashboard as Partial<ITestModeMemoryDashboardCallbackHost>).approveMemoryUpdate === "function" &&
    typeof (dashboard as Partial<ITestModeMemoryDashboardCallbackHost>).rejectMemoryUpdate === "function" &&
    dashboard.notificationService !== undefined;
}

function isDebugEnvEnabled(name: string): boolean {
  try {
    return globalThis.Deno?.env.get(name) === "1";
  } catch {
    return false;
  }
}

async function handleOverlayKeys(
  dashboard: ITestModeDashboard,
  key: string,
  panes: IPaneLike[],
  views: ITuiViewLike[],
  viewPickerRef: { index: number },
): Promise<number | null> {
  if (dashboard.state.showHelp) {
    return await dashboard.handleHelpOverlay?.(dashboard, key, panes) ?? 0;
  }

  if (dashboard.state.showMemoryNotifications) {
    if (dashboard.handleMemoryNotifications && hasMemoryNotificationContext(dashboard)) {
      return await dashboard.handleMemoryNotifications(dashboard, key, panes, dashboard.notificationService);
    }
    return 0;
  }

  if (dashboard.state.showViewPicker) {
    return dashboard.handleViewPicker?.(dashboard, key, views, panes, viewPickerRef) ?? -1;
  }

  return null;
}

function handleStateToggleKeys(
  dashboard: ITestModeDashboard,
  key: string,
  viewPickerRef: { index: number },
): boolean {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === KEYS.QUESTION || normalizedKey === KEYS.F1) {
    dashboard.state.showHelp = true;
    return true;
  }

  if (normalizedKey === KEYS.P) {
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

function handlePaneNavigationKeys(
  dashboard: ITestModeDashboard,
  key: string,
  panes: IPaneLike[],
): boolean {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === KEYS.TAB) {
    const currentIndex = panes.findIndex((pane) => pane.id === dashboard.activePaneId);
    if (isDebugEnvEnabled("EXA_TEST_LOG_TAB_DEBUG")) {
      console.debug(
        "[TUI][DEBUG] TAB pressed: panes=",
        panes.map((pane) => pane.id),
        "active=",
        dashboard.activePaneId,
        "currentIndex=",
        currentIndex,
      );
    }
    const nextIndex = (currentIndex + 1) % panes.length;
    dashboard.activePaneId = panes[nextIndex].id;
    panes.forEach((pane) => pane.focused = false);
    panes[nextIndex].focused = true;
    return true;
  }

  if (normalizedKey === KEYS.SHIFT_TAB.toLowerCase()) {
    const currentIndex = panes.findIndex((pane) => pane.id === dashboard.activePaneId);
    const previousIndex = (currentIndex - 1 + panes.length) % panes.length;
    dashboard.activePaneId = panes[previousIndex].id;
    panes.forEach((pane) => pane.focused = false);
    panes[previousIndex].focused = true;
    return true;
  }

  if (key >= KEYS.ONE && key <= KEYS.SEVEN) {
    const index = parseInt(key) - 1;
    if (index < panes.length) {
      panes.forEach((pane) => pane.focused = false);
      panes[index].focused = true;
      dashboard.activePaneId = panes[index].id;
    }
    return true;
  }

  return false;
}

async function handlePaneManagementKeys(
  dashboard: ITestModeDashboard,
  key: string,
  panes: IPaneLike[],
  views: ITuiViewLike[],
): Promise<boolean> {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === KEYS.V) {
    const result = await splitPane(
      panes,
      dashboard.activePaneId,
      views,
      SplitDirection.VERTICAL,
      dashboard.notify.bind(dashboard),
    );
    dashboard.activePaneId = result.activePaneId;
    return true;
  }

  if (normalizedKey === KEYS.H) {
    const result = await splitPane(
      panes,
      dashboard.activePaneId,
      views,
      SplitDirection.HORIZONTAL,
      dashboard.notify.bind(dashboard),
    );
    dashboard.activePaneId = result.activePaneId;
    return true;
  }

  if (normalizedKey === KEYS.C) {
    const result = await closePane(
      panes,
      dashboard.activePaneId,
      dashboard.activePaneId,
      dashboard.notify.bind(dashboard),
    );
    dashboard.activePaneId = result.activePaneId;
    return true;
  }

  if (normalizedKey === KEYS.Z) {
    maximizePane(panes, dashboard.activePaneId, dashboard.notify.bind(dashboard));
    return true;
  }

  return false;
}

async function handleLayoutOperationKeys(
  dashboard: ITestModeDashboard,
  key: string,
  panes: IPaneLike[],
): Promise<boolean> {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === KEYS.CTRL_LEFT.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, -0.05, 0);
    return true;
  }
  if (normalizedKey === KEYS.CTRL_RIGHT.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, 0.05, 0);
    return true;
  }
  if (normalizedKey === KEYS.CTRL_UP.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, 0, -0.05);
    return true;
  }
  if (normalizedKey === KEYS.CTRL_DOWN.toLowerCase()) {
    resizePane(panes, dashboard.activePaneId, 0, 0.05);
    return true;
  }
  if (normalizedKey === KEYS.S) {
    if (dashboard.saveLayout) await dashboard.saveLayout();
    return true;
  }
  if (normalizedKey === KEYS.R) {
    if (dashboard.restoreLayout) await dashboard.restoreLayout();
    return true;
  }
  if (normalizedKey === KEYS.D) {
    if (dashboard.resetToDefault) await dashboard.resetToDefault();
    return true;
  }
  return false;
}

export async function testModeHandleKey(
  dashboard: ITestModeDashboard,
  key: string,
  panes: IPaneLike[],
  views: ITuiViewLike[],
  viewPickerRef: { index: number },
): Promise<number> {
  const overlayResult = await handleOverlayKeys(dashboard, key, panes, views, viewPickerRef);
  if (overlayResult !== null) return overlayResult;

  if (handleStateToggleKeys(dashboard, key, viewPickerRef)) return 0;
  if (handlePaneNavigationKeys(dashboard, key, panes)) return 0;
  if (await handlePaneManagementKeys(dashboard, key, panes, views)) return 0;
  if (await handleLayoutOperationKeys(dashboard, key, panes)) return 0;

  if (key === KEYS.ENTER) {
    return 0;
  }

  const focusedPane = panes.find((pane) => pane.focused);
  if (focusedPane) {
    dashboard.activePaneId = focusedPane.id;
  }

  await Promise.resolve();
  return panes.findIndex((pane) => pane.id === dashboard.activePaneId);
}
