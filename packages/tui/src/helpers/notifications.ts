/**
 * @module TuiNotificationsHelper
 * @path packages/tui/src/helpers/notifications.ts
 * @description Helper functions for rendering and managing TUI notifications, including time formatting and interaction logic.
 * @architectural-layer TUI
 * @related-files ["packages/core/src/notification/notification.ts"]
 */

import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { colorize, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";
import { SECONDS_PER_HOUR } from "@exaix/core";
import type { IMemoryNotification, INotificationService } from "@exaix/core/types";

interface ITuiNotification extends IMemoryNotification {
  icon?: string;
}

export interface ITuiNotificationDashboardState {
  showMemoryNotifications: boolean;
  selectedMemoryNotifIndex: number;
}

export interface ITuiNotificationPane {
  id: string;
}

export interface IDashboardContext {
  state: ITuiNotificationDashboardState;
  activePaneId: string;
  approveMemoryUpdate: (id: string) => Promise<void>;
  rejectMemoryUpdate: (id: string) => Promise<void>;
}

export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export async function renderNotificationPanel(
  notificationService: INotificationService,
  theme: ITuiTheme,
  state: ITuiNotificationDashboardState,
  maxHeight = 10,
): Promise<string[]> {
  const lines: string[] = [];
  let activeNotifications = await notificationService.getNotifications() as ITuiNotification[];

  const messageColorByType: Record<string, string> = {
    error: theme.error,
    memory_rejected: theme.error,
    amendment_rejected: theme.error,
    amendment_expired: theme.error,
    warning: theme.warning,
    success: theme.success,
    memory_approved: theme.success,
    amendment_approved: theme.success,
    info: theme.primary,
    memory_update_pending: theme.primary,
    amendment_pending: theme.primary,
  };

  if (state.showMemoryNotifications) {
    activeNotifications = activeNotifications.filter((notification) => notification.type === "memory_update_pending");
  }

  if (activeNotifications.length === 0) {
    lines.push(colorize("  No notifications", theme.textDim, theme.reset));
    return lines;
  }

  const title = state.showMemoryNotifications ? "Pending Memory Updates" : "Notifications";
  lines.push(colorize(`🔔 ${title} (${activeNotifications.length})`, theme.h2, theme.reset));
  lines.push("");

  const visibleNotifications = activeNotifications.slice(0, maxHeight - 2);

  for (let index = 0; index < visibleNotifications.length; index++) {
    const notification = visibleNotifications[index];
    const type = notification.type;
    const icon = notification.icon || "ℹ️";
    const timestamp = notification.created_at ? new Date(notification.created_at) : new Date();
    const timeAgo = formatTimeAgo(timestamp);

    const isSelected = state.showMemoryNotifications && index === state.selectedMemoryNotifIndex;
    const messageColor = messageColorByType[String(type)] ?? theme.text;

    const prefix = isSelected ? "▶ " : "  ";
    let line = `${prefix}${icon} ${colorize(notification.message, messageColor, theme.reset)} ${
      colorize(`(${timeAgo})`, theme.textDim, theme.reset)
    }`;

    if (isSelected) {
      line = colorize(line, theme.primary, theme.reset);
    }
    lines.push(line);
  }

  if (activeNotifications.length > visibleNotifications.length) {
    const more = activeNotifications.length - visibleNotifications.length;
    lines.push(colorize(`  ... and ${more} more`, theme.textDim, theme.reset));
  }

  return lines;
}

export async function handleMemoryNotifications(
  self: IDashboardContext,
  key: string,
  panes: ITuiNotificationPane[],
  notificationService: INotificationService,
): Promise<number> {
  if (key === KEYS.ESCAPE || key === KEYS.M) {
    self.state.showMemoryNotifications = false;
    return panes.findIndex((pane) => pane.id === self.activePaneId);
  }

  const allNotifications = await notificationService.getNotifications();
  const memoryNotifications = allNotifications.filter((notification) => notification.type === "memory_update_pending");
  const count = memoryNotifications.length;

  const updateIndex = (delta: number): void => {
    if (count > 0) {
      self.state.selectedMemoryNotifIndex = (self.state.selectedMemoryNotifIndex + delta + count) % count;
    }
  };

  const approveOrReject = async (approve: boolean): Promise<void> => {
    if (count > 0 && self.state.selectedMemoryNotifIndex < count) {
      const selected = memoryNotifications[self.state.selectedMemoryNotifIndex];
      const id = (selected.proposal_id || selected.id) as string;
      if (approve) {
        await self.approveMemoryUpdate(id);
      } else {
        await self.rejectMemoryUpdate(id);
      }
    }
  };

  switch (key) {
    case "up":
    case "k":
      updateIndex(-1);
      break;
    case KEYS.DOWN:
    case "j":
      updateIndex(1);
      break;
    case "a":
      await approveOrReject(true);
      break;
    case "r":
      await approveOrReject(false);
      break;
      // no default
  }

  return panes.findIndex((pane) => pane.id === self.activePaneId);
}
