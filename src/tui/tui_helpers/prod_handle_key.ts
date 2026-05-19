/**
 * @module TuiProdHandleKey
 * @path src/tui/tui_helpers/prod_handle_key.ts
 * @description Production key handler for the TUI dashboard, wiring pane
 * management, layout persistence, and notification dispatch to keyboard events.
 * @architectural-layer TUI
 * @related-files [src/tui/tui_helpers/handle_key.ts, src/tui/tui_dashboard.ts]
 */
import { MessageType } from "@exaix/core";
import { SplitDirection } from "@exaix/tui";
import type { IDashboardViewState, IPane, ITuiView } from "../tui_dashboard.ts";
import type { IMemoryNotification } from "@exaix/core/types";
import type { INotificationService } from "@exaix/core/types";
import { closePane, maximizePane, resizePane, splitPane } from "../dashboard/pane_manager.ts";
import { KEYS } from "../helpers/keyboard.ts";

export interface IProdHandleCtx {
  prodState: IDashboardViewState;
  panes: IPane[];
  views: ITuiView[];
  activePaneRef: { id: string };
  notificationService: INotificationService;
  addNotification: (message: string, type?: string) => Promise<void>;
  saveLayout: () => Promise<void> | void;
  restoreLayout: () => Promise<void> | void;
  resetToDefault: () => void;
}

/**
 * Handles key events for memory notifications mode.
 * Processes navigation, approval, and rejection of memory notifications.
 */
async function handleMemoryNotificationsKey(
  key: string,
  ctx: IProdHandleCtx,
): Promise<{ exit?: boolean; reRender?: boolean }> {
  const { prodState, notificationService } = ctx;

  const exitKeys = new Set(["m", "\x1b", "esc"]);
  const navUpKeys = new Set(["\x1b[A", "k", "up"]);
  const navDownKeys = new Set(["\x1b[B", "j", KEYS.DOWN]);

  // Exit memory notifications mode
  if (exitKeys.has(key)) {
    prodState.showMemoryNotifications = false;
    return { reRender: true };
  }

  const allNotifs = await notificationService.getNotifications();
  const memoryNotifs = allNotifs.filter((n: IMemoryNotification) => n.type === "memory_update_pending");
  const count = memoryNotifs.length;

  // Navigation keys
  if (navUpKeys.has(key)) {
    if (count > 0) {
      prodState.selectedMemoryNotifIndex = (prodState.selectedMemoryNotifIndex - 1 + count) % count;
      return { reRender: true };
    }
    return { reRender: false };
  }

  if (navDownKeys.has(key)) {
    if (count > 0) {
      prodState.selectedMemoryNotifIndex = (prodState.selectedMemoryNotifIndex + 1) % count;
      return { reRender: true };
    }
    return { reRender: false };
  }

  // Action keys
  if (count === 0) return { reRender: false };

  const action = key.toLowerCase();
  if (action === "a") {
    const selected = memoryNotifs[prodState.selectedMemoryNotifIndex];
    await notificationService.notify(`Approved: ${selected.message}`, MessageType.SUCCESS);
    await notificationService.clearNotification((selected.proposal_id || selected.id) as string);
    return { reRender: true };
  }

  if (action === "r") {
    const selected = memoryNotifs[prodState.selectedMemoryNotifIndex];
    await notificationService.notify(`Rejected: ${selected.message}`, MessageType.ERROR);
    await notificationService.clearNotification((selected.proposal_id || selected.id) as string);
    return { reRender: true };
  }

  return { reRender: false };
}

/**
 * Handles key events for notification panel mode.
 * Processes exit from notification panel.
 */
function handleNotificationPanelKey(key: string, ctx: IProdHandleCtx): { exit?: boolean; reRender?: boolean } {
  const { prodState } = ctx;

  if (key === KEYS.N || key === "\x1b" || key === KEYS.ESCAPE) {
    prodState.showNotifications = false;
    return { reRender: true };
  }

  return { reRender: false };
}

/**
 * Handles global commands like exit, help, and notification toggles.
 */
function handleGlobalCommands(
  key: string,
  ctx: IProdHandleCtx,
): { exit?: boolean; reRender?: boolean } | null {
  const { prodState } = ctx;

  if (key === "\x1b") { // Esc
    return { exit: true };
  } else if (key === KEYS.QUESTION) { // Help
    prodState.showHelp = true;
    return { reRender: true };
  } else if (key === KEYS.N) { // Notifications toggle
    prodState.showNotifications = !prodState.showNotifications;
    return { reRender: true };
  } else if (key === KEYS.M) { // Memory updates toggle
    prodState.showMemoryNotifications = !prodState.showMemoryNotifications;
    prodState.selectedMemoryNotifIndex = 0;
    return { reRender: true };
  }

  return null;
}

/**
 * Handles pane navigation keys (tab, shift+tab, direct pane jump).
 */
function handlePaneNavigation(
  key: string,
  ctx: IProdHandleCtx,
): { reRender: boolean } | null {
  const { panes, activePaneRef } = ctx;

  // Helper to find active pane index
  const findActiveIndex = () => panes.findIndex((p) => p.id === activePaneRef.id);

  if (key === "\t" || key === KEYS.TAB) { // Tab
    const currentIndex = findActiveIndex();
    const nextIndex = (currentIndex + 1) % panes.length;
    activePaneRef.id = panes[nextIndex].id;
    panes.forEach((p) => p.focused = false);
    panes[nextIndex].focused = true;
    return { reRender: true };
  } else if (key === "\x1b[Z" || key === KEYS.SHIFT_TAB) { // Shift+Tab
    const currentIndex = findActiveIndex();
    const prevIndex = (currentIndex - 1 + panes.length) % panes.length;
    activePaneRef.id = panes[prevIndex].id;
    panes.forEach((p) => p.focused = false);
    panes[prevIndex].focused = true;
    return { reRender: true };
  } else if (key >= KEYS.ONE && key <= KEYS.SEVEN) { // Direct pane jump
    const idx = parseInt(key) - 1;
    if (idx < panes.length) {
      panes.forEach((p) => p.focused = false);
      panes[idx].focused = true;
      activePaneRef.id = panes[idx].id;
      return { reRender: true };
    }
    return { reRender: false };
  }

  return null;
}

/**
 * Handles pane management operations (split, close, maximize).
 */
async function handlePaneManagement(
  key: string,
  ctx: IProdHandleCtx,
): Promise<{ reRender: boolean } | null> {
  const { panes, views, activePaneRef, addNotification } = ctx;

  if (key === KEYS.V) { // Split vertical
    await splitPane(panes, activePaneRef.id, views, SplitDirection.VERTICAL, addNotification);
    return { reRender: true };
  } else if (key === KEYS.H) { // Split horizontal
    await splitPane(panes, activePaneRef.id, views, SplitDirection.HORIZONTAL, addNotification);
    return { reRender: true };
  } else if (key === KEYS.C) { // Close pane
    const result = await closePane(panes, activePaneRef.id, activePaneRef.id, addNotification);
    activePaneRef.id = result.activePaneId;
    return { reRender: true };
  } else if (key === KEYS.Z) { // Maximize/restore
    maximizePane(panes, activePaneRef.id, addNotification);
    return { reRender: true };
  }

  return null;
}

/**
 * Handles pane resizing operations (Ctrl+arrow keys).
 */
function handlePaneResizing(
  key: string,
  ctx: IProdHandleCtx,
): { reRender: boolean } | null {
  const { panes, activePaneRef } = ctx;

  if (key === "\x1b[1;5D" || key === KEYS.CTRL_LEFT) { // Ctrl+Left
    resizePane(panes, activePaneRef.id, -0.05, 0);
    return { reRender: true };
  } else if (key === "\x1b[1;5C" || key === KEYS.CTRL_RIGHT) { // Ctrl+Right
    resizePane(panes, activePaneRef.id, 0.05, 0);
    return { reRender: true };
  } else if (key === "\x1b[1;5A" || key === KEYS.CTRL_UP) { // Ctrl+Up
    resizePane(panes, activePaneRef.id, 0, -0.05);
    return { reRender: true };
  } else if (key === "\x1b[1;5B" || key === KEYS.CTRL_DOWN) { // Ctrl+Down
    resizePane(panes, activePaneRef.id, 0, 0.05);
    return { reRender: true };
  }

  return null;
}

/**
 * Handles layout operations (save, restore, reset).
 */
async function handleLayoutOperations(
  key: string,
  ctx: IProdHandleCtx,
): Promise<{ reRender: boolean } | null> {
  if (key === "\n" || key === KEYS.ENTER) {
    // Enter: show selected pane info (no-op for helper)
    return { reRender: true };
  } else if (key === KEYS.S) {
    await ctx.saveLayout();
    return { reRender: true };
  } else if (key === KEYS.R) {
    await ctx.restoreLayout();
    return { reRender: true };
  } else if (key === KEYS.D) {
    ctx.resetToDefault();
    return { reRender: true };
  }

  return null;
}

/**
 * Handles key events for top-level navigation and commands.
 * Processes pane navigation, splitting, resizing, layout operations, and global commands.
 */
async function handleTopLevelNavigationKey(
  key: string,
  ctx: IProdHandleCtx,
): Promise<{ exit?: boolean; reRender?: boolean }> {
  // Global commands
  const globalResult = handleGlobalCommands(key, ctx);
  if (globalResult) return globalResult;

  // IPane navigation
  const navigationResult = handlePaneNavigation(key, ctx);
  if (navigationResult) return navigationResult;

  // IPane management
  const managementResult = await handlePaneManagement(key, ctx);
  if (managementResult) return managementResult;

  // IPane resizing
  const resizeResult = handlePaneResizing(key, ctx);
  if (resizeResult) return resizeResult;

  // Layout operations
  const layoutResult = await handleLayoutOperations(key, ctx);
  if (layoutResult) return layoutResult;

  // No-op for unrecognized keys
  return { reRender: false };
}

/**
 * Handles key events for the production TUI (Text User Interface) environment.
 * Processes navigation, pane management, notification toggling, and memory notification actions
 * based on the provided key input and current context state.
 *
 * @param key - The key input string, which may be a single character, a named key, or an escape sequence.
 * @param ctx - The context object containing state, pane, view, and notification management utilities.
 * @returns A promise resolving to an object indicating whether to exit or re-render the UI.
 *
 * Key code notes:
 * - Keys starting with `\x1b` are escape sequences, commonly used for special keys in terminal environments.
 *   - `\x1b` is the Escape character (ESC).
 *   - `\x1b[A` is the Up Arrow key.
 *   - `\x1b[B` is the Down Arrow key.
 *   - `\x1b[Z` is Shift+Tab.
 *   - `\x1b[1;5D` is Ctrl+Left Arrow.
 *   - `\x1b[1;5C` is Ctrl+Right Arrow.
 *   - `\x1b[1;5A` is Ctrl+Up Arrow.
 *   - `\x1b[1;5B` is Ctrl+Down Arrow.
 *
 * Other key constants (e.g., KEYS.N, KEYS.M, KEYS.QUESTION) are defined in the KEYS object and represent
 * specific keyboard shortcuts for the TUI.
 */
export async function prodHandleKey(key: string, ctx: IProdHandleCtx): Promise<{ exit?: boolean; reRender?: boolean }> {
  const { prodState } = ctx;

  // Memory notifications handling
  if (prodState.showMemoryNotifications) {
    return await handleMemoryNotificationsKey(key, ctx);
  }

  // Notification panel handling
  if (prodState.showNotifications) {
    return handleNotificationPanelKey(key, ctx);
  }

  // Top-level navigation and commands
  return await handleTopLevelNavigationKey(key, ctx);
}

export default prodHandleKey;
