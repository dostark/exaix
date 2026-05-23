/**
 * @module LayoutDialogs
 * @path packages/tui/src/dialogs/layout_dialogs.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned dialog components for TUI layout management, view picking, and resize indicators.
 */

import { DialogPurpose, LayoutMode } from "../types/enums.ts";
import { colorize, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";
import {
  TUI_DASHBOARD_ICONS,
  TUI_LAYOUT_PRESET_LIST_WIDTH,
  TUI_SEPARATOR_ROW,
  TUI_VIEW_PICKER_INNER_WIDTH,
} from "@exaix/tui/helpers/constants.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { type ILayoutPresetDisplay, renderLayoutPresetListLines } from "@exaix/tui/layout/rendering.ts";

export interface IViewInfo {
  name: string;
  icon: string;
  description: string;
}

export const AVAILABLE_VIEWS: IViewInfo[] = [
  {
    name: "PortalManagerView",
    icon: TUI_DASHBOARD_ICONS.views.PortalManagerView,
    description: "Manage project portals",
  },
  { name: "PlanReviewerView", icon: TUI_DASHBOARD_ICONS.views.PlanReviewerView, description: "Review agent plans" },
  { name: "MonitorView", icon: TUI_DASHBOARD_ICONS.views.MonitorView, description: "Real-time logs" },
  { name: "DaemonControlView", icon: TUI_DASHBOARD_ICONS.views.DaemonControlView, description: "Daemon control" },
  { name: "AgentStatusView", icon: TUI_DASHBOARD_ICONS.views.AgentStatusView, description: "Agent health" },
  { name: "RequestManagerView", icon: TUI_DASHBOARD_ICONS.views.RequestManagerView, description: "Manage requests" },
  { name: "MemoryView", icon: TUI_DASHBOARD_ICONS.views.MemoryView, description: "Memory banks" },
];

export interface IViewPickerDialogState {
  isOpen: boolean;
  selectedIndex: number;
  purpose: DialogPurpose;
  targetPaneId?: string;
}

export interface ILayoutPresetDialogState {
  isOpen: boolean;
  selectedIndex: number;
}

export interface ILayoutPresetInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  shortcut: string;
}

export interface INamedLayoutDialogState {
  isOpen: boolean;
  mode: LayoutMode;
  layouts: string[];
  selectedIndex: number;
  inputName: string;
  inputActive: boolean;
}

export interface IResizeModeState {
  isActive: boolean;
  paneId: string | null;
}

export function createViewPickerState(): IViewPickerDialogState {
  return {
    isOpen: false,
    selectedIndex: 0,
    purpose: DialogPurpose.SPLIT,
  };
}

export function createLayoutPresetState(): ILayoutPresetDialogState {
  return {
    isOpen: false,
    selectedIndex: 0,
  };
}

export function renderViewPickerDialog(state: IViewPickerDialogState, theme: ITuiTheme): string[] {
  if (!state.isOpen) return [];

  const lines: string[] = [];
  const title = state.purpose === DialogPurpose.SPLIT
    ? "Select View for New IPane"
    : state.purpose === DialogPurpose.CHANGE
    ? "Change View"
    : "Select View";

  lines.push(colorize("┌──────────────────────────────────────┐", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(` ${title.padEnd(TUI_VIEW_PICKER_INNER_WIDTH)} `, theme.h1, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize("├──────────────────────────────────────┤", theme.border, theme.reset));

  const viewDisplays: ILayoutPresetDisplay[] = AVAILABLE_VIEWS.map((view, index) => ({
    name: view.name.replace("View", ""),
    description: view.description,
    icon: view.icon,
    shortcut: String(index + 1),
  }));

  lines.push(
    ...renderLayoutPresetListLines(viewDisplays, state.selectedIndex, theme, { width: TUI_VIEW_PICKER_INNER_WIDTH }),
  );
  lines.push(colorize("├──────────────────────────────────────┤", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(" ↑↓ Navigate  Enter Select  Esc Cancel", theme.textDim, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize("└──────────────────────────────────────┘", theme.border, theme.reset));

  return lines;
}

export function handleViewPickerKey(
  state: IViewPickerDialogState,
  key: string,
): { state: IViewPickerDialogState; selectedView?: string; closed: boolean } {
  if (!state.isOpen) return { state, closed: false };

  const newState = { ...state };
  switch (key.toLowerCase()) {
    case KEYS.UP:
    case KEYS.K:
      newState.selectedIndex = (state.selectedIndex - 1 + AVAILABLE_VIEWS.length) % AVAILABLE_VIEWS.length;
      return { state: newState, closed: false };
    case KEYS.DOWN:
    case KEYS.J:
      newState.selectedIndex = (state.selectedIndex + 1) % AVAILABLE_VIEWS.length;
      return { state: newState, closed: false };
    case KEYS.ENTER:
      newState.isOpen = false;
      return { state: newState, selectedView: AVAILABLE_VIEWS[state.selectedIndex].name, closed: true };
    case KEYS.ESCAPE:
    case KEYS.Q:
      newState.isOpen = false;
      return { state: newState, closed: true };
    default:
      if (key >= "1" && key <= "7") {
        const index = parseInt(key) - 1;
        if (index < AVAILABLE_VIEWS.length) {
          newState.isOpen = false;
          return { state: newState, selectedView: AVAILABLE_VIEWS[index].name, closed: true };
        }
      }
      return { state: newState, closed: false };
  }
}

export const LAYOUT_PRESET_INFO: ILayoutPresetInfo[] = [
  { id: "single", name: "Single", icon: "□", description: "Full-screen single pane", shortcut: "1" },
  { id: "side-by-side", name: "Side by Side", icon: "▯▯", description: "Two panes left/right", shortcut: "2" },
  { id: "stacked", name: "Stacked", icon: "▭▭", description: "Two panes top/bottom", shortcut: "3" },
  { id: "quad", name: "Quad", icon: "⊞", description: "Four equal panes", shortcut: "4" },
  { id: "main-sidebar", name: "Main + Sidebar", icon: "▮▯", description: "Large main with sidebar", shortcut: "5" },
  { id: "triple", name: "Triple", icon: "▮▭", description: "Main with stacked sidebars", shortcut: "6" },
];

export function renderLayoutPresetDialog(state: ILayoutPresetDialogState, theme: ITuiTheme): string[] {
  if (!state.isOpen) return [];

  const lines: string[] = [];
  lines.push(colorize("┌────────────────────────────────────────┐", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize("          Layout Presets               ", theme.h1, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize(TUI_SEPARATOR_ROW, theme.border, theme.reset));
  lines.push(
    ...renderLayoutPresetListLines(LAYOUT_PRESET_INFO, state.selectedIndex, theme, {
      width: TUI_LAYOUT_PRESET_LIST_WIDTH,
    }),
  );
  lines.push(colorize(TUI_SEPARATOR_ROW, theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(" ↑↓ Navigate  Enter Select  Esc Cancel", theme.textDim, theme.reset) +
      colorize(" │", theme.border, theme.reset),
  );
  lines.push(colorize("└────────────────────────────────────────┘", theme.border, theme.reset));
  return lines;
}

export function handleLayoutPresetKey(
  state: ILayoutPresetDialogState,
  key: string,
): { state: ILayoutPresetDialogState; selectedPreset?: string; closed: boolean } {
  if (!state.isOpen) return { state, closed: false };

  const newState = { ...state };
  switch (key.toLowerCase()) {
    case KEYS.UP:
    case KEYS.K:
      newState.selectedIndex = (state.selectedIndex - 1 + LAYOUT_PRESET_INFO.length) % LAYOUT_PRESET_INFO.length;
      return { state: newState, closed: false };
    case KEYS.DOWN:
    case KEYS.J:
      newState.selectedIndex = (state.selectedIndex + 1) % LAYOUT_PRESET_INFO.length;
      return { state: newState, closed: false };
    case KEYS.ENTER:
      newState.isOpen = false;
      return { state: newState, selectedPreset: LAYOUT_PRESET_INFO[state.selectedIndex].id, closed: true };
    case KEYS.ESCAPE:
    case KEYS.Q:
      newState.isOpen = false;
      return { state: newState, closed: true };
    default:
      if (key >= "1" && key <= "6") {
        const index = parseInt(key) - 1;
        if (index < LAYOUT_PRESET_INFO.length) {
          newState.isOpen = false;
          return { state: newState, selectedPreset: LAYOUT_PRESET_INFO[index].id, closed: true };
        }
      }
      return { state: newState, closed: false };
  }
}

export function createNamedLayoutState(): INamedLayoutDialogState {
  return {
    isOpen: false,
    mode: LayoutMode.SAVE,
    layouts: [],
    selectedIndex: 0,
    inputName: "",
    inputActive: false,
  };
}

export function renderNamedLayoutDialog(state: INamedLayoutDialogState, theme: ITuiTheme): string[] {
  if (!state.isOpen) return [];

  const lines: string[] = [];
  const title = state.mode === LayoutMode.SAVE
    ? "Save Layout"
    : state.mode === LayoutMode.LOAD
    ? "Load Layout"
    : "Delete Layout";

  lines.push(colorize("┌────────────────────────────────────────┐", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(` ${title.padEnd(38)} `, theme.h1, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize(TUI_SEPARATOR_ROW, theme.border, theme.reset));

  if (state.mode === LayoutMode.SAVE) {
    const inputLine = state.inputActive
      ? colorize(`Name: ${state.inputName}_`, theme.primary, theme.reset)
      : colorize(`Name: ${state.inputName || "(enter name)"}`, theme.text, theme.reset);

    lines.push(
      colorize("│", theme.border, theme.reset) + " " + inputLine.padEnd(38) + " " +
        colorize("│", theme.border, theme.reset),
    );
    lines.push(
      colorize("│", theme.border, theme.reset) + "                                        " +
        colorize("│", theme.border, theme.reset),
    );
  }

  if (state.layouts.length > 0) {
    lines.push(
      colorize("│", theme.border, theme.reset) +
        colorize(" Saved Layouts:                        ", theme.h2, theme.reset) +
        colorize("│", theme.border, theme.reset),
    );

    const savedLayoutDisplays: ILayoutPresetDisplay[] = state.layouts.map((layout) => ({
      name: layout,
      description: "",
      icon: TUI_DASHBOARD_ICONS.layout.save,
      shortcut: "",
    }));

    const selectedIndex = state.mode === LayoutMode.SAVE ? null : state.selectedIndex;
    lines.push(...renderLayoutPresetListLines(savedLayoutDisplays, selectedIndex, theme, {
      width: TUI_LAYOUT_PRESET_LIST_WIDTH,
      showDescription: false,
    }));
  } else if (state.mode !== LayoutMode.SAVE) {
    lines.push(
      colorize("│", theme.border, theme.reset) +
        colorize("   No saved layouts                    ", theme.textDim, theme.reset) +
        colorize("│", theme.border, theme.reset),
    );
  }

  lines.push(colorize(TUI_SEPARATOR_ROW, theme.border, theme.reset));
  const hint = state.mode === LayoutMode.SAVE
    ? " Type name, Enter to save, Esc cancel  "
    : state.mode === LayoutMode.DELETE
    ? " Enter to delete, Esc to cancel        "
    : " Enter to load, Esc to cancel          ";

  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(hint, theme.textDim, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize("└────────────────────────────────────────┘", theme.border, theme.reset));
  return lines;
}

export function handleNamedLayoutKey(
  state: INamedLayoutDialogState,
  key: string,
): { state: INamedLayoutDialogState; action?: LayoutMode; layoutName?: string; closed: boolean } {
  if (!state.isOpen) return { state, closed: false };

  const newState = { ...state };
  const saveInputResult = handleSaveModeInputKey(state, newState, key);
  if (saveInputResult) return saveInputResult;

  switch (key.toLowerCase()) {
    case KEYS.UP:
    case KEYS.K:
      if (state.layouts.length > 0) {
        newState.selectedIndex = (state.selectedIndex - 1 + state.layouts.length) % state.layouts.length;
      }
      return { state: newState, closed: false };
    case KEYS.DOWN:
    case KEYS.J:
      if (state.layouts.length > 0) {
        newState.selectedIndex = (state.selectedIndex + 1) % state.layouts.length;
      }
      return { state: newState, closed: false };
    case KEYS.ENTER:
      if (state.mode === LayoutMode.SAVE) {
        newState.inputActive = true;
        return { state: newState, closed: false };
      }
      if (state.layouts.length > 0) {
        newState.isOpen = false;
        return { state: newState, action: state.mode, layoutName: state.layouts[state.selectedIndex], closed: true };
      }
      return { state: newState, closed: false };
    case KEYS.ESCAPE:
    case KEYS.Q:
      newState.isOpen = false;
      newState.inputName = "";
      newState.inputActive = false;
      return { state: newState, closed: true };
    default:
      return { state: newState, closed: false };
  }
}

function handleSaveModeInputKey(
  state: INamedLayoutDialogState,
  newState: INamedLayoutDialogState,
  key: string,
): { state: INamedLayoutDialogState; action?: LayoutMode; layoutName?: string; closed: boolean } | null {
  if (state.mode !== LayoutMode.SAVE || !state.inputActive) return null;

  if (key === KEYS.ENTER && state.inputName.trim()) {
    newState.isOpen = false;
    newState.inputActive = false;
    return { state: newState, action: LayoutMode.SAVE, layoutName: state.inputName.trim(), closed: true };
  }
  if (key === KEYS.ESCAPE) {
    newState.isOpen = false;
    newState.inputActive = false;
    newState.inputName = "";
    return { state: newState, closed: true };
  }
  if (key === KEYS.BACKSPACE) {
    newState.inputName = state.inputName.slice(0, -1);
    return { state: newState, closed: false };
  }
  if (key.length === 1 && /[a-zA-Z0-9_-]/.test(key)) {
    newState.inputName = state.inputName + key;
  }
  return { state: newState, closed: false };
}

export function renderSwapIndicator(sourcePaneId: string, targetPaneId: string | null, theme: ITuiTheme): string {
  if (targetPaneId) {
    return colorize(`Swap: ${sourcePaneId} ⇄ ${targetPaneId}`, theme.warning, theme.reset);
  }
  return colorize(`Swapping from: ${sourcePaneId} (Tab to select target)`, theme.primary, theme.reset);
}

export function createResizeModeState(): IResizeModeState {
  return { isActive: false, paneId: null };
}

export function renderResizeModeIndicator(state: IResizeModeState, theme: ITuiTheme): string {
  if (!state.isActive) return "";
  return colorize("[RESIZE MODE] Use Ctrl+Arrow keys to resize, Esc to exit", theme.warning, theme.reset);
}
