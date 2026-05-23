/**
 * @module DashboardRenderer
 * @path apps/tui/src/dashboard/renderer.ts
 * @description Production renderer for the TUI dashboard, managing window sizing, header/footer rendering, and pane layout.
 * @architectural-layer TUI
 * @related-files [apps/tui/src/tui_dashboard.ts, packages/tui/src/layout/pane_manager.ts]
 */

import process from "node:process";
import type { ITuiTheme } from "@exaix/tui/helpers/colors.ts";
import {
  TUI_MSG_DASHBOARD_HEADER,
  TUI_MSG_PRESS_CLOSE_HELP,
  TUI_STATUS_MSG_READY,
} from "@exaix/tui/helpers/constants.ts";
import { type IPane, renderGlobalHelpOverlay, renderPaneTitleBar, renderViewIndicator } from "../tui_dashboard.ts";
import { renderNotificationPanel } from "@exaix/tui/helpers/notifications.ts";
import type { IMemoryNotification } from "@exaix/core/types";
import type { INotificationService, IPortalService } from "@exaix/core/types";
import type { IDashboardViewState } from "../tui_dashboard.ts";
import { Table } from "@cliffy/table";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
async function renderActivePaneContent(
  panes: IPane[],
  activePaneId: string,
  theme: ITuiTheme,
  portalView: IPortalService,
): Promise<void> {
  const activePane = panes.find((p) => p.id === activePaneId);
  if (!activePane) return;

  if (activePane.view.name === "PortalManagerView") {
    const portals = await portalView.listPortals();
    if (portals.length > 0) {
      const table = new Table();
      table.header(["Alias", "Target Path", "Status"]);
      for (const p of portals) {
        table.push([p.alias, p.targetPath, p.status]);
      }
      table.render();
    } else {
      console.log("No portals configured.");
    }
    return;
  }

  const titleBar = renderPaneTitleBar(activePane, theme);
  console.log(titleBar);
  console.log("");
  console.log(`Viewing: ${activePane.view.name}`);
  console.log(`Bounds: x=${activePane.x}, y=${activePane.y}, w=${activePane.width}, h=${activePane.height}`);
  console.log(`Flex: ${activePane.flexWidth.toFixed(2)}x${activePane.flexHeight.toFixed(2)}`);
}

async function renderStatusBar(
  width: number,
  headerLine: string,
  notificationService: INotificationService,
): Promise<void> {
  console.log("");
  console.log(`╠${headerLine}╣`);

  const allNotifs = await notificationService.getNotifications();
  const activeNotifs = allNotifs.filter((n: IMemoryNotification) => !n.dismissed_at);
  const notifBadge = activeNotifs.length > 0 ? ` 🔔 ${activeNotifs.length}` : "";
  const statusLine = ` Status: ${TUI_STATUS_MSG_READY}${notifBadge}`;
  console.log(`║${statusLine}${" ".repeat(Math.max(0, width - 2 - statusLine.length))}║`);
  console.log(`╠${headerLine}╣`);
  const navLine = " Navigation: Tab/Shift+Tab | Split: v/h | Close: c | Resize: Ctrl+Arrows | Help: ?";
  console.log(`║${navLine.padEnd(width - 2)}║`);
  const layoutLine = " Layout: s=save, r=restore, d=default | n=notifications | p=view picker";
  console.log(`║${layoutLine.padEnd(width - 2)}║`);
  console.log(`╚${headerLine}╝`);
}

/**
 * Production render function for the dashboard
 */
export async function prodRender(
  panes: IPane[],
  activePaneId: string,
  state: IDashboardViewState,
  theme: ITuiTheme,
  notificationService: INotificationService,
  portalView: IPortalService,
): Promise<void> {
  let width: number;
  let height: number;

  try {
    const { columns, rows } = Deno.consoleSize();
    width = columns;
    height = rows;
  } catch {
    // Fallback for environments without TTY (like CI)
    width = 80;
    height = 24;
  }

  // Update absolute coordinates for all panes based on flex values
  for (const pane of panes) {
    if (pane.maximized) {
      pane.x = 0;
      pane.y = 2; // header height
      pane.width = width;
      pane.height = height - 5; // header + status bar
    } else {
      pane.x = Math.floor(pane.flexX * width);
      pane.y = 2 + Math.floor(pane.flexY * (height - 5));
      pane.width = Math.floor(pane.flexWidth * width);
      pane.height = Math.floor(pane.flexHeight * (height - 5));
    }
  }

  console.clear();

  // Header
  const headerLine = "═".repeat(width - 2);
  console.log(`╔${headerLine}╗`);
  const headerText = TUI_MSG_DASHBOARD_HEADER.trim();
  const padding = Math.max(0, Math.floor((width - 2 - headerText.length) / 2));
  console.log(`║${" ".repeat(padding)}${headerText}${" ".repeat(width - 2 - padding - headerText.length)}║`);
  console.log(`╠${headerLine}╣`);

  // View indicators
  const viewIndicator = renderViewIndicator(panes, activePaneId, theme);
  // We need to strip colors for padding calculation or just use a simpler method
  console.log(`║ ${viewIndicator}${" ".repeat(Math.max(0, width - 4 - 20))} ║`); // simplified padding
  console.log(`╠${headerLine}╣`);

  // Help overlay
  if (state.showHelp) {
    const helpLines = renderGlobalHelpOverlay(theme);
    for (const line of helpLines) {
      console.log(line);
    }
    console.log(TUI_MSG_PRESS_CLOSE_HELP);
    return;
  }

  // Notification panel
  if (state.showNotifications || state.showMemoryNotifications) {
    const notifLines = await renderNotificationPanel(notificationService, theme, state);
    for (const line of notifLines) {
      console.log(line);
    }
    const closeKey = state.showMemoryNotifications ? KEYS.M : KEYS.N;
    process.stdout.write(`\nPress ${closeKey} to close`);
    if (state.showMemoryNotifications) {
      process.stdout.write(` | ${KEYS.M}: Approve | ${KEYS.R}: Reject | Up/Down: Navigate\n`);
    } else {
      process.stdout.write("\n");
    }
    return;
  }

  // Main content (simplified multi-pane rendering)
  // For now, Exaix dashboard renders the active pane or portal view
  // To support true multi-pane rendering, we'd need a virtual grid or buffer
  // For this refactor, we maintain the "view active pane" logic but with flexible bounds

  await renderActivePaneContent(panes, activePaneId, theme, portalView);
  await renderStatusBar(width, headerLine, notificationService);
}
