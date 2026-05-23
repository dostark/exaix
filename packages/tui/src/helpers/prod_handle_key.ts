/**
 * @module TuiProdHandleKey
 * @path packages/tui/src/helpers/prod_handle_key.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned production key routing for the TUI dashboard.
 */

import { MessageType } from "@exaix/core";
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

export interface IProdDashboardState {
  showHelp: boolean;
  showNotifications: boolean;
  showMemoryNotifications: boolean;
  selectedMemoryNotifIndex: number;
}

export interface IMemoryNotificationLike {
  id?: string;
  proposal_id?: string;
  message: string;
  type: string;
}

export interface INotificationServiceLike {
  getNotifications(): Promise<IMemoryNotificationLike[]>;
  notify(message: string, type?: string): Promise<void>;
  clearNotification(id: string): Promise<void>;
}

export interface IProdHandleCtx {
  prodState: IProdDashboardState;
  panes: IPaneLike[];
  views: ITuiViewLike[];
  activePaneRef: { id: string };
  notificationService: INotificationServiceLike;
  addNotification: (message: string, type?: string) => Promise<void>;
  saveLayout: () => Promise<void> | void;
  restoreLayout: () => Promise<void> | void;
  resetToDefault: () => void;
}

async function handleMemoryNotificationsKey(
  key: string,
  ctx: IProdHandleCtx,
): Promise<{ exit?: boolean; reRender?: boolean }> {
  const exitKeys = new Set(["m", "\x1b", "esc"]);
  const navigationUpKeys = new Set(["\x1b[A", "k", "up"]);
  const navigationDownKeys = new Set(["\x1b[B", "j", KEYS.DOWN]);

  if (exitKeys.has(key)) {
    ctx.prodState.showMemoryNotifications = false;
    return { reRender: true };
  }

  const notifications = await ctx.notificationService.getNotifications();
  const memoryNotifications = notifications.filter((notification) => notification.type === "memory_update_pending");
  const count = memoryNotifications.length;

  if (navigationUpKeys.has(key)) {
    if (count > 0) {
      ctx.prodState.selectedMemoryNotifIndex = (ctx.prodState.selectedMemoryNotifIndex - 1 + count) % count;
      return { reRender: true };
    }
    return { reRender: false };
  }

  if (navigationDownKeys.has(key)) {
    if (count > 0) {
      ctx.prodState.selectedMemoryNotifIndex = (ctx.prodState.selectedMemoryNotifIndex + 1) % count;
      return { reRender: true };
    }
    return { reRender: false };
  }

  if (count === 0) return { reRender: false };

  const action = key.toLowerCase();
  if (action === "a") {
    const selected = memoryNotifications[ctx.prodState.selectedMemoryNotifIndex];
    await ctx.notificationService.notify(`Approved: ${selected.message}`, MessageType.SUCCESS);
    await ctx.notificationService.clearNotification((selected.proposal_id || selected.id) as string);
    return { reRender: true };
  }

  if (action === "r") {
    const selected = memoryNotifications[ctx.prodState.selectedMemoryNotifIndex];
    await ctx.notificationService.notify(`Rejected: ${selected.message}`, MessageType.ERROR);
    await ctx.notificationService.clearNotification((selected.proposal_id || selected.id) as string);
    return { reRender: true };
  }

  return { reRender: false };
}

function handleNotificationPanelKey(key: string, ctx: IProdHandleCtx): { exit?: boolean; reRender?: boolean } {
  if (key === KEYS.N || key === "\x1b" || key === KEYS.ESCAPE) {
    ctx.prodState.showNotifications = false;
    return { reRender: true };
  }
  return { reRender: false };
}

function handleGlobalCommands(key: string, ctx: IProdHandleCtx): { exit?: boolean; reRender?: boolean } | null {
  if (key === "\x1b") return { exit: true };
  if (key === KEYS.QUESTION) {
    ctx.prodState.showHelp = true;
    return { reRender: true };
  }
  if (key === KEYS.N) {
    ctx.prodState.showNotifications = !ctx.prodState.showNotifications;
    return { reRender: true };
  }
  if (key === KEYS.M) {
    ctx.prodState.showMemoryNotifications = !ctx.prodState.showMemoryNotifications;
    ctx.prodState.selectedMemoryNotifIndex = 0;
    return { reRender: true };
  }
  return null;
}

function handlePaneNavigation(key: string, ctx: IProdHandleCtx): { reRender: boolean } | null {
  const findActiveIndex = () => ctx.panes.findIndex((pane) => pane.id === ctx.activePaneRef.id);

  if (key === "\t" || key === KEYS.TAB) {
    const currentIndex = findActiveIndex();
    const nextIndex = (currentIndex + 1) % ctx.panes.length;
    ctx.activePaneRef.id = ctx.panes[nextIndex].id;
    ctx.panes.forEach((pane) => pane.focused = false);
    ctx.panes[nextIndex].focused = true;
    return { reRender: true };
  }

  if (key === "\x1b[Z" || key === KEYS.SHIFT_TAB) {
    const currentIndex = findActiveIndex();
    const previousIndex = (currentIndex - 1 + ctx.panes.length) % ctx.panes.length;
    ctx.activePaneRef.id = ctx.panes[previousIndex].id;
    ctx.panes.forEach((pane) => pane.focused = false);
    ctx.panes[previousIndex].focused = true;
    return { reRender: true };
  }

  if (key >= KEYS.ONE && key <= KEYS.SEVEN) {
    const index = parseInt(key) - 1;
    if (index < ctx.panes.length) {
      ctx.panes.forEach((pane) => pane.focused = false);
      ctx.panes[index].focused = true;
      ctx.activePaneRef.id = ctx.panes[index].id;
      return { reRender: true };
    }
    return { reRender: false };
  }

  return null;
}

async function handlePaneManagement(key: string, ctx: IProdHandleCtx): Promise<{ reRender: boolean } | null> {
  if (key === KEYS.V) {
    await splitPane(ctx.panes, ctx.activePaneRef.id, ctx.views, SplitDirection.VERTICAL, ctx.addNotification);
    return { reRender: true };
  }
  if (key === KEYS.H) {
    await splitPane(ctx.panes, ctx.activePaneRef.id, ctx.views, SplitDirection.HORIZONTAL, ctx.addNotification);
    return { reRender: true };
  }
  if (key === KEYS.C) {
    const result = await closePane(ctx.panes, ctx.activePaneRef.id, ctx.activePaneRef.id, ctx.addNotification);
    ctx.activePaneRef.id = result.activePaneId;
    return { reRender: true };
  }
  if (key === KEYS.Z) {
    maximizePane(ctx.panes, ctx.activePaneRef.id, ctx.addNotification);
    return { reRender: true };
  }
  return null;
}

function handlePaneResizing(key: string, ctx: IProdHandleCtx): { reRender: boolean } | null {
  if (key === "\x1b[1;5D" || key === KEYS.CTRL_LEFT) {
    resizePane(ctx.panes, ctx.activePaneRef.id, -0.05, 0);
    return { reRender: true };
  }
  if (key === "\x1b[1;5C" || key === KEYS.CTRL_RIGHT) {
    resizePane(ctx.panes, ctx.activePaneRef.id, 0.05, 0);
    return { reRender: true };
  }
  if (key === "\x1b[1;5A" || key === KEYS.CTRL_UP) {
    resizePane(ctx.panes, ctx.activePaneRef.id, 0, -0.05);
    return { reRender: true };
  }
  if (key === "\x1b[1;5B" || key === KEYS.CTRL_DOWN) {
    resizePane(ctx.panes, ctx.activePaneRef.id, 0, 0.05);
    return { reRender: true };
  }
  return null;
}

async function handleLayoutOperations(key: string, ctx: IProdHandleCtx): Promise<{ reRender: boolean } | null> {
  if (key === "\n" || key === KEYS.ENTER) return { reRender: true };
  if (key === KEYS.S) {
    await ctx.saveLayout();
    return { reRender: true };
  }
  if (key === KEYS.R) {
    await ctx.restoreLayout();
    return { reRender: true };
  }
  if (key === KEYS.D) {
    ctx.resetToDefault();
    return { reRender: true };
  }
  return null;
}

async function handleTopLevelNavigationKey(
  key: string,
  ctx: IProdHandleCtx,
): Promise<{ exit?: boolean; reRender?: boolean }> {
  const globalResult = handleGlobalCommands(key, ctx);
  if (globalResult) return globalResult;

  const navigationResult = handlePaneNavigation(key, ctx);
  if (navigationResult) return navigationResult;

  const managementResult = await handlePaneManagement(key, ctx);
  if (managementResult) return managementResult;

  const resizeResult = handlePaneResizing(key, ctx);
  if (resizeResult) return resizeResult;

  const layoutResult = await handleLayoutOperations(key, ctx);
  if (layoutResult) return layoutResult;

  return { reRender: false };
}

export async function prodHandleKey(key: string, ctx: IProdHandleCtx): Promise<{ exit?: boolean; reRender?: boolean }> {
  if (ctx.prodState.showMemoryNotifications) {
    return await handleMemoryNotificationsKey(key, ctx);
  }

  if (ctx.prodState.showNotifications) {
    return handleNotificationPanelKey(key, ctx);
  }

  return await handleTopLevelNavigationKey(key, ctx);
}
