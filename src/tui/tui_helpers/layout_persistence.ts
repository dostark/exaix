/**
 * @module LayoutPersistence
 * @path src/tui/tui_helpers/layout_persistence.ts
 * @description Utilities for saving, restoring, and resetting TUI dashboard layouts to/from local storage.
 * @architectural-layer TUI
 * * @related-files [src/tui/tui_dashboard.ts]
 */

import { MessageType } from "../../shared/enums.ts";
import type { IPane, ITuiView } from "../tui_dashboard.ts";
import { TUI_LAYOUT_DEFAULT_HEIGHT, TUI_LAYOUT_FULL_WIDTH, TUI_MAIN_PANE_ID } from "../helpers/constants.ts";

export const getLayoutFile = (): string => `${Deno.env.get("HOME")}/.exaix/tui_layout.json`;

export async function saveLayout(
  panes: IPane[],
  activePaneId: string,
  addNotification: (m: string, t?: string) => void,
): Promise<void> {
  try {
    await Deno.mkdir(`${Deno.env.get("HOME")}/.exaix`, { recursive: true });
    const layout = {
      panes: panes.map((p) => ({
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
        maximized: p.maximized,
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
  panes: IPane[],
  views: ITuiView[],
  addNotification: (m: string, t?: string) => void,
): Promise<{ activePaneId?: string } | null> {
  try {
    const content = await Deno.readTextFile(getLayoutFile());
    const layout = JSON.parse(content);
    if ((layout.version === "1.0" || layout.version === "1.1" || layout.version === "1.2") && layout.panes) {
      panes.length = 0;
      for (const p of layout.panes) {
        const view = views.find((v) => v.name === p.viewName) || views[0];
        // Upgrade from 1.0/1.1 (absolute) to 1.2 (flex)
        const flexX = p.flexX ?? (p.x / TUI_LAYOUT_FULL_WIDTH);
        const flexY = p.flexY ?? (p.y / TUI_LAYOUT_DEFAULT_HEIGHT);
        const flexWidth = p.flexWidth ?? (p.width / TUI_LAYOUT_FULL_WIDTH);
        const flexHeight = p.flexHeight ?? (p.height / TUI_LAYOUT_DEFAULT_HEIGHT);

        panes.push({
          id: p.id,
          view,
          flexX,
          flexY,
          flexWidth,
          flexHeight,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          focused: p.focused,
          maximized: p.maximized ?? false,
        });
      }
      const activePaneId = layout.activePaneId || panes[0]?.id || TUI_MAIN_PANE_ID;
      addNotification("Layout restored", "SUCCESS");
      return { activePaneId };
    }
  } catch (_error) {
    // If restore fails, keep default layout
    // noop
  }
  return null;
}

export function resetToDefault(
  panes: IPane[],
  views: ITuiView[],
  addNotification: (m: string, t?: string) => void,
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
