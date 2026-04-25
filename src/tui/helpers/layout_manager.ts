/**
 * @module LayoutManager
 * @path src/tui/helpers/layout_manager.ts
 * @description Layout Manager for split-view TUI dashboards, providing presets, resizing, and named layout persistence.
 * @architectural-layer TUI Helpers
 * * @related-files [src/tui/helpers/layout_rendering.ts]
 */

import { colorize, type ITuiTheme } from "./colors.ts";
import { renderLayoutPresetListLines } from "./layout_rendering.ts";
import { TUI_LAYOUT_DEFAULT_HEIGHT, TUI_LAYOUT_FULL_WIDTH, TUI_MAIN_PANE_ID, TUI_SEPARATOR_ROW } from "./constants.ts";
import { ResizeDirection, SplitDirection, TuiViewName } from "@exaix/core";
import type { JSONObject } from "../../shared/types/json.ts";
import type { JSONValue } from "@exaix/core";

// ===== Layout Interfaces =====

export interface IPaneBounds extends JSONObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ILayoutPane extends JSONObject {
  id: string;
  viewName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
  maximized?: boolean;
  previousBounds?: IPaneBounds;
}

export interface ILayout extends JSONObject {
  name: string;
  panes: ILayoutPane[];
  activePaneId: string;
  version: string;
  createdAt?: string;
  description?: string;
}

export interface ILayoutPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  shortcut: string;
  create: (width: number, height: number, views: string[]) => ILayoutPane[];
}

// ===== Layout Constants =====

export const LAYOUT_VERSION = "1.2";

export const MIN_PANE_WIDTH = 20;
export const MIN_PANE_HEIGHT = 5;
export const MAX_PANES = 6;

// ===== Layout Presets =====

export const LAYOUT_PRESETS: ILayoutPreset[] = [
  {
    id: "single",
    name: "Single",
    description: "Single full-screen pane",
    icon: "□",
    shortcut: "1",
    create: (width, height, views) => [{
      id: TUI_MAIN_PANE_ID,
      viewName: views[0] || TuiViewName.PORTAL_MANAGER,
      x: 0,
      y: 0,
      width,
      height,
      focused: true,
    }],
  },
  {
    id: "side-by-side",
    name: "Side by Side",
    description: "Two panes, vertical split",
    icon: "▯▯",
    shortcut: "2",
    create: (width, height, views) => {
      const halfWidth = Math.floor(width / 2);
      return [
        {
          id: "left",
          viewName: views[0] || TuiViewName.PORTAL_MANAGER,
          x: 0,
          y: 0,
          width: halfWidth,
          height,
          focused: true,
        },
        {
          id: "right",
          viewName: views[1] || TuiViewName.MONITOR,
          x: halfWidth,
          y: 0,
          width: width - halfWidth,
          height,
          focused: false,
        },
      ];
    },
  },
  {
    id: "stacked",
    name: "Stacked",
    description: "Two panes, horizontal split",
    icon: "▭▭",
    shortcut: "3",
    create: (width, height, views) => {
      const halfHeight = Math.floor(height / 2);
      return [
        {
          id: "top",
          viewName: views[0] || TuiViewName.PORTAL_MANAGER,
          x: 0,
          y: 0,
          width,
          height: halfHeight,
          focused: true,
        },
        {
          id: "bottom",
          viewName: views[1] || TuiViewName.MONITOR,
          x: 0,
          y: halfHeight,
          width,
          height: height - halfHeight,
          focused: false,
        },
      ];
    },
  },
  {
    id: "quad",
    name: "Quad",
    description: "Four equal panes",
    icon: "⊞",
    shortcut: "4",
    create: (width, height, views) => {
      const halfWidth = Math.floor(width / 2);
      const halfHeight = Math.floor(height / 2);
      return [
        {
          id: "top-left",
          viewName: views[0] || TuiViewName.PORTAL_MANAGER,
          x: 0,
          y: 0,
          width: halfWidth,
          height: halfHeight,
          focused: true,
        },
        {
          id: "top-right",
          viewName: views[1] || TuiViewName.PLAN_REVIEWER,
          x: halfWidth,
          y: 0,
          width: width - halfWidth,
          height: halfHeight,
          focused: false,
        },
        {
          id: "bottom-left",
          viewName: views[2] || TuiViewName.MONITOR,
          x: 0,
          y: halfHeight,
          width: halfWidth,
          height: height - halfHeight,
          focused: false,
        },
        {
          id: "bottom-right",
          viewName: views[3] || TuiViewName.DAEMON_CONTROL,
          x: halfWidth,
          y: halfHeight,
          width: width - halfWidth,
          height: height - halfHeight,
          focused: false,
        },
      ];
    },
  },
  {
    id: "main-sidebar",
    name: "Main + Sidebar",
    description: "Large main pane with sidebar",
    icon: "▮▯",
    shortcut: "5",
    create: (width, height, views) => {
      const mainWidth = Math.floor(width * 0.7);
      return [
        {
          id: TUI_MAIN_PANE_ID,
          viewName: views[0] || TuiViewName.PORTAL_MANAGER,
          x: 0,
          y: 0,
          width: mainWidth,
          height,
          focused: true,
        },
        {
          id: "sidebar",
          viewName: views[1] || TuiViewName.MONITOR,
          x: mainWidth,
          y: 0,
          width: width - mainWidth,
          height,
          focused: false,
        },
      ];
    },
  },
  {
    id: "triple",
    name: "Triple",
    description: "Main pane with two stacked sidebars",
    icon: "▮▭",
    shortcut: "6",
    create: (width, height, views) => {
      const mainWidth = Math.floor(width * 0.6);
      const halfHeight = Math.floor(height / 2);
      return [
        {
          id: TUI_MAIN_PANE_ID,
          viewName: views[0] || TuiViewName.PORTAL_MANAGER,
          x: 0,
          y: 0,
          width: mainWidth,
          height,
          focused: true,
        },
        {
          id: "sidebar-top",
          viewName: views[1] || TuiViewName.PLAN_REVIEWER,
          x: mainWidth,
          y: 0,
          width: width - mainWidth,
          height: halfHeight,
          focused: false,
        },
        {
          id: "sidebar-bottom",
          viewName: views[2] || "MonitorView",
          x: mainWidth,
          y: halfHeight,
          width: width - mainWidth,
          height: height - halfHeight,
          focused: false,
        },
      ];
    },
  },
];

// ===== Layout Manager Class =====

type ResizeDirectionAlias = ResizeDirection;

function resizePaneLeft(pane: ILayoutPane, affected: ILayoutPane | undefined, amount: number) {
  if (pane.width - amount < MIN_PANE_WIDTH) return;
  pane.width -= amount;
  if (affected && affected.x > pane.x) {
    affected.x -= amount;
    affected.width += amount;
  }
}

function resizePaneRight(
  pane: ILayoutPane,
  affected: ILayoutPane | undefined,
  amount: number,
  terminalWidth: number,
) {
  if (affected && affected.width - amount >= MIN_PANE_WIDTH) {
    pane.width += amount;
    affected.x += amount;
    affected.width -= amount;
    return;
  }
  if (!affected && pane.x + pane.width + amount <= terminalWidth) {
    pane.width += amount;
  }
}

function resizePaneUp(pane: ILayoutPane, affected: ILayoutPane | undefined, amount: number) {
  if (pane.height - amount < MIN_PANE_HEIGHT) return;
  pane.height -= amount;
  if (affected && affected.y > pane.y) {
    affected.y -= amount;
    affected.height += amount;
  }
}

function resizePaneDown(
  pane: ILayoutPane,
  affected: ILayoutPane | undefined,
  amount: number,
  terminalHeight: number,
) {
  if (affected && affected.height - amount >= MIN_PANE_HEIGHT) {
    pane.height += amount;
    affected.y += amount;
    affected.height -= amount;
    return;
  }
  if (!affected && pane.y + pane.height + amount <= terminalHeight) {
    pane.height += amount;
  }
}

const RESIZE_PANE_HANDLERS: Record<
  ResizeDirection,
  (args: {
    pane: ILayoutPane;
    affected?: ILayoutPane;
    amount: number;
    terminalWidth: number;
    terminalHeight: number;
  }) => void
> = {
  [ResizeDirection.LEFT]: ({ pane, affected, amount }) => resizePaneLeft(pane, affected, amount),
  [ResizeDirection.RIGHT]: ({ pane, affected, amount, terminalWidth }) =>
    resizePaneRight(pane, affected, amount, terminalWidth),
  [ResizeDirection.UP]: ({ pane, affected, amount }) => resizePaneUp(pane, affected, amount),
  [ResizeDirection.DOWN]: ({ pane, affected, amount, terminalHeight }) =>
    resizePaneDown(pane, affected, amount, terminalHeight),
};

export class LayoutManager {
  private terminalWidth: number;
  private terminalHeight: number;
  private namedLayouts: Map<string, ILayout> = new Map();

  constructor(width: number = TUI_LAYOUT_FULL_WIDTH, height: number = TUI_LAYOUT_DEFAULT_HEIGHT) {
    this.terminalWidth = width;
    this.terminalHeight = height;
  }

  // ===== Terminal Size =====

  setTerminalSize(width: number, height: number): void {
    this.terminalWidth = width;
    this.terminalHeight = height;
  }

  getTerminalSize(): { width: number; height: number } {
    return { width: this.terminalWidth, height: this.terminalHeight };
  }

  // ===== Preset Operations =====

  getPresets(): ILayoutPreset[] {
    return LAYOUT_PRESETS;
  }

  getPresetById(id: string): ILayoutPreset | undefined {
    return LAYOUT_PRESETS.find((p) => p.id === id);
  }

  getPresetByShortcut(shortcut: string): ILayoutPreset | undefined {
    return LAYOUT_PRESETS.find((p) => p.shortcut === shortcut);
  }

  applyPreset(presetId: string, views: string[]): ILayoutPane[] {
    const preset = this.getPresetById(presetId);
    if (!preset) {
      throw new Error(`Unknown layout preset: ${presetId}`);
    }
    return preset.create(this.terminalWidth, this.terminalHeight, views);
  }

  // ===== IPane Operations =====

  splitPane(
    panes: ILayoutPane[],
    paneId: string,
    direction: SplitDirection,
    newViewName: string,
  ): ILayoutPane[] {
    if (panes.length >= MAX_PANES) {
      throw new Error(`Maximum panes (${MAX_PANES}) reached`);
    }

    const pane = panes.find((p) => p.id === paneId);
    if (!pane) {
      throw new Error(`IPane not found: ${paneId}`);
    }

    const newId = `pane-${Date.now()}`;

    if (direction === SplitDirection.VERTICAL) {
      const halfWidth = Math.floor(pane.width / 2);
      if (halfWidth < MIN_PANE_WIDTH) {
        throw new Error(`IPane too narrow to split (min: ${MIN_PANE_WIDTH})`);
      }

      // Resize original pane
      pane.width = halfWidth;

      // Create new pane
      const newPane: ILayoutPane = {
        id: newId,
        viewName: newViewName,
        x: pane.x + halfWidth,
        y: pane.y,
        width: pane.width,
        height: pane.height,
        focused: false,
      };

      return [...panes, newPane];
    } else {
      const halfHeight = Math.floor(pane.height / 2);
      if (halfHeight < MIN_PANE_HEIGHT) {
        throw new Error(`IPane too short to split (min: ${MIN_PANE_HEIGHT})`);
      }

      // Resize original pane
      pane.height = halfHeight;

      // Create new pane
      const newPane: ILayoutPane = {
        id: newId,
        viewName: newViewName,
        x: pane.x,
        y: pane.y + halfHeight,
        width: pane.width,
        height: pane.height,
        focused: false,
      };

      return [...panes, newPane];
    }
  }

  closePane(panes: ILayoutPane[], paneId: string): ILayoutPane[] {
    if (panes.length <= 1) {
      throw new Error("Cannot close the last pane");
    }

    const index = panes.findIndex((p) => p.id === paneId);
    if (index === -1) {
      throw new Error(`IPane not found: ${paneId}`);
    }

    const closedPane = panes[index];
    const remaining = panes.filter((p) => p.id !== paneId);

    // Expand adjacent pane to fill the space
    // Find pane that shares an edge
    const adjacent = this.findAdjacentPane(remaining, closedPane);
    if (adjacent) {
      this.expandToFill(adjacent, closedPane);
    }

    // Ensure at least one pane is focused
    if (!remaining.some((p) => p.focused) && remaining.length > 0) {
      remaining[0].focused = true;
    }

    return remaining;
  }

  private findAdjacentPane(panes: ILayoutPane[], closed: ILayoutPane): ILayoutPane | undefined {
    // Prefer horizontal adjacency (same row)
    const horizontal = panes.find(
      (p) =>
        p.y === closed.y &&
        p.height === closed.height &&
        (p.x + p.width === closed.x || closed.x + closed.width === p.x),
    );
    if (horizontal) return horizontal;

    // Try vertical adjacency (same column)
    const vertical = panes.find(
      (p) =>
        p.x === closed.x &&
        p.width === closed.width &&
        (p.y + p.height === closed.y || closed.y + closed.height === p.y),
    );
    if (vertical) return vertical;

    // Fall back to first pane
    return panes[0];
  }

  private expandToFill(pane: ILayoutPane, closed: ILayoutPane): void {
    // If same row, expand horizontally
    if (pane.y === closed.y && pane.height === closed.height) {
      if (pane.x + pane.width === closed.x) {
        // Closed was to the right
        pane.width += closed.width;
      } else if (closed.x + closed.width === pane.x) {
        // Closed was to the left
        pane.x = closed.x;
        pane.width += closed.width;
      }
    } else if (pane.x === closed.x && pane.width === closed.width) {
      if (pane.y + pane.height === closed.y) {
        // Closed was below
        pane.height += closed.height;
      } else if (closed.y + closed.height === pane.y) {
        // Closed was above
        pane.y = closed.y;
        pane.height += closed.height;
      }
    }
  }

  resizePane(
    panes: ILayoutPane[],
    paneId: string,
    direction: ResizeDirection,
    amount: number = 5,
  ): ILayoutPane[] {
    const pane = panes.find((p) => p.id === paneId);
    if (!pane) {
      throw new Error(`IPane not found: ${paneId}`);
    }

    // Find adjacent pane that will be affected
    const affected = this.findAffectedPane(panes, pane, direction);

    RESIZE_PANE_HANDLERS[direction]({
      pane,
      affected,
      amount,
      terminalWidth: this.terminalWidth,
      terminalHeight: this.terminalHeight,
    });

    return panes;
  }

  private findAffectedPane(
    panes: ILayoutPane[],
    source: ILayoutPane,
    direction: ResizeDirection,
  ): ILayoutPane | undefined {
    switch (direction) {
      case ResizeDirection.RIGHT:
        return panes.find(
          (p) =>
            p.id !== source.id &&
            p.x === source.x + source.width &&
            this.overlapsVertically(p, source),
        );
      case ResizeDirection.LEFT:
        return panes.find(
          (p) =>
            p.id !== source.id &&
            p.x + p.width === source.x &&
            this.overlapsVertically(p, source),
        );
      case ResizeDirection.DOWN:
        return panes.find(
          (p) =>
            p.id !== source.id &&
            p.y === source.y + source.height &&
            this.overlapsHorizontally(p, source),
        );
      case ResizeDirection.UP:
        return panes.find(
          (p) =>
            p.id !== source.id &&
            p.y + p.height === source.y &&
            this.overlapsHorizontally(p, source),
        );
    }
  }

  private overlapsVertically(a: ILayoutPane, b: ILayoutPane): boolean {
    return !(a.y + a.height <= b.y || b.y + b.height <= a.y);
  }

  private overlapsHorizontally(a: ILayoutPane, b: ILayoutPane): boolean {
    return !(a.x + a.width <= b.x || b.x + b.width <= a.x);
  }

  swapPanes(panes: ILayoutPane[], paneId1: string, paneId2: string): ILayoutPane[] {
    const pane1 = panes.find((p) => p.id === paneId1);
    const pane2 = panes.find((p) => p.id === paneId2);

    if (!pane1 || !pane2) {
      throw new Error("One or both panes not found");
    }

    // Swap view names (keep positions)
    const tempView = pane1.viewName;
    pane1.viewName = pane2.viewName;
    pane2.viewName = tempView;

    return panes;
  }

  maximizePane(panes: ILayoutPane[], paneId: string): ILayoutPane[] {
    const pane = panes.find((p) => p.id === paneId);
    if (!pane) {
      throw new Error(`IPane not found: ${paneId}`);
    }

    if (pane.maximized) {
      // Restore
      if (pane.previousBounds) {
        pane.x = pane.previousBounds.x;
        pane.y = pane.previousBounds.y;
        pane.width = pane.previousBounds.width;
        pane.height = pane.previousBounds.height;
        pane.previousBounds = undefined;
      }
      pane.maximized = false;
    } else {
      // Maximize
      pane.previousBounds = {
        x: pane.x,
        y: pane.y,
        width: pane.width,
        height: pane.height,
      };
      pane.x = 0;
      pane.y = 0;
      pane.width = this.terminalWidth;
      pane.height = this.terminalHeight;
      pane.maximized = true;
    }

    return panes;
  }

  // ===== Named Layouts =====

  saveNamedLayout(name: string, panes: ILayoutPane[], activePaneId: string): ILayout {
    const layout: ILayout = {
      name,
      panes: panes.map((p) => ({ ...p })),
      activePaneId,
      version: LAYOUT_VERSION,
      createdAt: new Date().toISOString(),
    };
    this.namedLayouts.set(name, layout);
    return layout;
  }

  loadNamedLayout(name: string): ILayout | undefined {
    return this.namedLayouts.get(name);
  }

  deleteNamedLayout(name: string): boolean {
    return this.namedLayouts.delete(name);
  }

  listNamedLayouts(): string[] {
    return Array.from(this.namedLayouts.keys());
  }

  getNamedLayouts(): ILayout[] {
    return Array.from(this.namedLayouts.values());
  }

  // ===== Layout Serialization =====

  serializeLayout(panes: ILayoutPane[], activePaneId: string): string {
    const layout: ILayout = {
      name: "default",
      panes: panes.map((p) => ({
        id: p.id,
        viewName: p.viewName,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        focused: p.focused,
        maximized: p.maximized,
      })),
      activePaneId,
      version: LAYOUT_VERSION,
    };
    return JSON.stringify(layout, null, 2);
  }

  deserializeLayout(json: string): ILayout | null {
    try {
      const layout = JSON.parse(json);
      if (this.validateLayout(layout)) {
        return layout;
      }
      return null;
    } catch {
      return null;
    }
  }

  validateLayout(layout: JSONValue): layout is ILayout {
    if (typeof layout !== "object" || layout === null) return false;
    const l = layout as JSONObject;

    const requiredLayoutStrings: Array<keyof ILayout> = ["name", "activePaneId", "version"];
    if (requiredLayoutStrings.some((k) => typeof l[k] !== "string")) return false;
    if (!Array.isArray(l.panes)) return false;

    const requiredPaneStrings = ["id", "viewName"] as const;
    const requiredPaneNumbers = ["x", "y", "width", "height"] as const;

    for (const pane of l.panes) {
      if (typeof pane !== "object" || pane === null) return false;
      const p = pane as JSONObject;

      if (requiredPaneStrings.some((k) => typeof p[k] !== "string")) return false;
      if (requiredPaneNumbers.some((k) => typeof p[k] !== "number")) return false;
    }

    return true;
  }

  // ===== Layout Normalization =====

  normalizeLayout(panes: ILayoutPane[]): ILayoutPane[] {
    // Ensure panes fit within terminal bounds
    return panes.map((pane) => {
      // First normalize position
      const x = Math.max(0, Math.min(pane.x, this.terminalWidth - MIN_PANE_WIDTH));
      const y = Math.max(0, Math.min(pane.y, this.terminalHeight - MIN_PANE_HEIGHT));
      // Then normalize size based on new position
      const width = Math.max(MIN_PANE_WIDTH, Math.min(pane.width, this.terminalWidth - x));
      const height = Math.max(MIN_PANE_HEIGHT, Math.min(pane.height, this.terminalHeight - y));
      return { ...pane, x, y, width, height };
    });
  }
}

// ===== Rendering Helpers =====

export function renderLayoutPresetPicker(
  presets: ILayoutPreset[],
  selectedIndex: number,
  theme: ITuiTheme,
): string[] {
  const lines: string[] = [];

  lines.push(colorize("┌────────────────────────────────────────┐", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize("          Layout Presets               ", theme.h1, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize(TUI_SEPARATOR_ROW, theme.border, theme.reset));

  lines.push(
    ...renderLayoutPresetListLines(
      presets,
      selectedIndex,
      theme,
      { width: 38, includeSuffix: true },
    ),
  );

  lines.push(colorize(TUI_SEPARATOR_ROW, theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(" Enter to apply, Esc to cancel        ", theme.textDim, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize("└────────────────────────────────────────┘", theme.border, theme.reset));

  return lines;
}

export function renderPaneBorder(pane: ILayoutPane, theme: ITuiTheme): string {
  const icon = pane.focused ? "●" : "○";
  const viewShort = pane.viewName.replace("View", "");
  const maxLabel = pane.maximized ? " [MAX]" : "";

  if (pane.focused) {
    return colorize(`${icon} ${viewShort}${maxLabel}`, theme.primary, theme.reset);
  }
  return colorize(`${icon} ${viewShort}${maxLabel}`, theme.textDim, theme.reset);
}

export function renderResizeIndicator(
  direction: ResizeDirection,
  theme: ITuiTheme,
): string {
  const arrows: Record<ResizeDirection, string> = {
    [ResizeDirection.LEFT]: "◀",
    [ResizeDirection.RIGHT]: "▶",
    [ResizeDirection.UP]: "▲",
    [ResizeDirection.DOWN]: "▼",
  };
  return colorize(`Resize ${arrows[direction]}`, theme.primary, theme.reset);
}

// ===== Default Export =====

export function createLayoutManager(width?: number, height?: number): LayoutManager {
  return new LayoutManager(width, height);
}
