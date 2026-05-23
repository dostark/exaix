/**
 * @module LayoutPersistence
 * @path packages/tui/src/layout/persistence.ts
 * @description Utilities for saving, restoring, and resetting TUI dashboard layouts to/from local storage.
 * @architectural-layer TUI
 * @ungrounded Layout
 * @related-files ["packages/tui/src/helpers/constants.ts"]
 */

import { MessageType } from "@exaix/core";
import { TUI_LAYOUT_DEFAULT_HEIGHT, TUI_LAYOUT_FULL_WIDTH, TUI_MAIN_PANE_ID } from "../helpers/constants.ts";

export interface ITuiLayoutPersistenceView {
  name: string;
}

export interface ITuiLayoutPersistencePane {
  id: string;
  view: ITuiLayoutPersistenceView;
  flexX: number;
  flexY: number;
  flexWidth: number;
  flexHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
  maximized?: boolean;
}

export const getLayoutFile = (): string => `${Deno.env.get("HOME")}/.exaix/tui_layout.json`;

export async function saveLayout(
  panes: ITuiLayoutPersistencePane[],
  activePaneId: string,
  addNotification: (message: string, type?: string) => void,
): Promise<void> {
  try {
    await Deno.mkdir(`${Deno.env.get("HOME")}/.exaix`, { recursive: true });
    const layout = {
      panes: panes.map((pane) => ({
        id: pane.id,
        viewName: pane.view.name,
        flexX: pane.flexX,
        flexY: pane.flexY,
        flexWidth: pane.flexWidth,
        flexHeight: pane.flexHeight,
        x: pane.x,
        y: pane.y,
        width: pane.width,
        height: pane.height,
        focused: pane.focused,
        maximized: pane.maximized,
      })),
      activePaneId,
      version: "1.2",
    };
    await Deno.writeTextFile(getLayoutFile(), JSON.stringify(layout, null, 2));
    addNotification("Layout saved", "SUCCESS");
  } catch (error) {
    addNotification(`Failed to save layout: ${error}`, "ERROR");
  }
}

export async function restoreLayout(
  panes: ITuiLayoutPersistencePane[],
  views: ITuiLayoutPersistenceView[],
  addNotification: (message: string, type?: string) => void,
): Promise<{ activePaneId?: string } | null> {
  try {
    const content = await Deno.readTextFile(getLayoutFile());
    const layout = JSON.parse(content);
    if ((layout.version === "1.0" || layout.version === "1.1" || layout.version === "1.2") && layout.panes) {
      panes.length = 0;
      for (const pane of layout.panes) {
        const view = views.find((candidate) => candidate.name === pane.viewName) || views[0];
        const flexX = pane.flexX ?? (pane.x / TUI_LAYOUT_FULL_WIDTH);
        const flexY = pane.flexY ?? (pane.y / TUI_LAYOUT_DEFAULT_HEIGHT);
        const flexWidth = pane.flexWidth ?? (pane.width / TUI_LAYOUT_FULL_WIDTH);
        const flexHeight = pane.flexHeight ?? (pane.height / TUI_LAYOUT_DEFAULT_HEIGHT);

        panes.push({
          id: pane.id,
          view,
          flexX,
          flexY,
          flexWidth,
          flexHeight,
          x: pane.x,
          y: pane.y,
          width: pane.width,
          height: pane.height,
          focused: pane.focused,
          maximized: pane.maximized ?? false,
        });
      }
      const activePaneId = layout.activePaneId || panes[0]?.id || TUI_MAIN_PANE_ID;
      addNotification("Layout restored", "SUCCESS");
      return { activePaneId };
    }
  } catch {
    // Keep the default layout when no saved layout is available.
  }
  return null;
}

export function resetToDefault(
  panes: ITuiLayoutPersistencePane[],
  views: ITuiLayoutPersistenceView[],
  addNotification: (message: string, type?: string) => void,
): string {
  panes.length = 0;
  panes.push({
    id: TUI_MAIN_PANE_ID,
    view: views[0],
    flexX: 0,
    flexY: 0,
    flexWidth: 1.0,
    flexHeight: 1.0,
    x: 0,
    y: 0,
    width: TUI_LAYOUT_FULL_WIDTH,
    height: TUI_LAYOUT_DEFAULT_HEIGHT,
    focused: true,
    maximized: false,
  });
  addNotification("Layout reset to default", MessageType.INFO);
  return TUI_MAIN_PANE_ID;
}

export default { getLayoutFile, saveLayout, restoreLayout, resetToDefault };
