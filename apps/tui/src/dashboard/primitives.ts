/**
 * @module TuiDashboardPrimitives
 * @path apps/tui/src/dashboard/primitives.ts
 * @description The pane, view and dashboard-state contracts plus the renderers that the dashboard and its view registry share.
 * @architectural-layer TUI
 * @dependencies [@exaix/tui/helpers/constants.ts, @exaix/tui/helpers/colors.ts, @exaix/tui/helpers/keyboard.ts, @exaix/tui/helpers/help_renderer.ts]
 * @related-files [apps/tui/src/tui_dashboard.ts, apps/tui/src/dashboard/renderer.ts, apps/tui/src/dashboard/view_registry.ts]
 */

import { TUI_DASHBOARD_ICONS } from "@exaix/tui/helpers/constants.ts";
import { colorize, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";
import { type IHelpSection, renderHelpScreen } from "@exaix/tui/helpers/help_renderer.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";

/** The theme shape of the dashboard renderers. */
type Theme = ITuiTheme;

/** Common interface for all TUI views to ensure consistent orchestration. */
export interface ITuiView {
  name: string;
  render?(): string[] | Promise<string[] | string> | string;
  handleKey?(key: string): Promise<boolean | number>;
  dispose?(): void;
  destroy?(): void;
  getFocusableElements?(): string[];
}

export interface IDashboardViewState {
  showHelp: boolean;
  showNotifications: boolean;
  showViewPicker: boolean;
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;
  currentTheme: string;
  highContrast: boolean;
  screenReader: boolean;
  showMemoryNotifications: boolean;
  selectedMemoryNotifIndex: number;
}

export interface IPane {
  id: string;
  view: ITuiView;
  /** Relative flex position and size (0.0 to 1.0) */
  flexX: number;
  flexY: number;
  flexWidth: number;
  flexHeight: number;
  /** Calculated screen coordinates (pixels/chars) */
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
  maximized?: boolean;
  previousBounds?: {
    flexX: number;
    flexY: number;
    flexWidth: number;
    flexHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export const DASHBOARD_ICONS = {
  views: {
    PortalManagerView: TUI_DASHBOARD_ICONS.views.PortalManagerView,
    PlanReviewerView: TUI_DASHBOARD_ICONS.views.PlanReviewerView,
    MonitorView: TUI_DASHBOARD_ICONS.views.MonitorView,
    StructuredLogViewer: TUI_DASHBOARD_ICONS.views.StructuredLogViewer,
    DaemonControlView: TUI_DASHBOARD_ICONS.views.DaemonControlView,
    AgentStatusView: TUI_DASHBOARD_ICONS.views.AgentStatusView,
    RequestManagerView: TUI_DASHBOARD_ICONS.views.RequestManagerView,
    MemoryView: TUI_DASHBOARD_ICONS.views.MemoryView,
    SkillsManagerView: TUI_DASHBOARD_ICONS.views.SkillsManagerView,
  } as Record<string, string>,
  pane: {
    focused: TUI_DASHBOARD_ICONS.pane.focused,
    unfocused: TUI_DASHBOARD_ICONS.pane.unfocused,
    split: TUI_DASHBOARD_ICONS.pane.split,
    horizontal: TUI_DASHBOARD_ICONS.pane.horizontal,
    corner: TUI_DASHBOARD_ICONS.pane.corner,
  },
  notification: {
    info: TUI_DASHBOARD_ICONS.notification.info,
    success: TUI_DASHBOARD_ICONS.notification.success,
    warning: TUI_DASHBOARD_ICONS.notification.warning,
    error: TUI_DASHBOARD_ICONS.notification.error,
    bell: TUI_DASHBOARD_ICONS.notification.bell,
    memory_update_pending: TUI_DASHBOARD_ICONS.notification.memory_update_pending,
    memory_approved: TUI_DASHBOARD_ICONS.notification.memory_approved,
    memory_rejected: TUI_DASHBOARD_ICONS.notification.memory_rejected,
  },
  layout: {
    single: TUI_DASHBOARD_ICONS.layout.single,
    vertical: TUI_DASHBOARD_ICONS.layout.vertical,
    horizontal: TUI_DASHBOARD_ICONS.layout.horizontal,
    quad: TUI_DASHBOARD_ICONS.layout.quad,
    save: TUI_DASHBOARD_ICONS.layout.save,
    load: TUI_DASHBOARD_ICONS.layout.load,
    reset: TUI_DASHBOARD_ICONS.layout.reset,
  },
} as const;

export function getDashboardHelpSections(): IHelpSection[] {
  return [
    {
      title: "Navigation",
      items: [
        { key: KEYS.TAB, description: "Switch to next pane" },
        { key: KEYS.SHIFT_TAB, description: "Switch to previous pane" },
        { key: KEYS.ONE_TO_SEVEN, description: "Jump directly to pane" },
      ],
    },
    {
      title: "Layout Management",
      items: [
        { key: KEYS.V, description: "Split pane vertically (left/right)" },
        { key: KEYS.H, description: "Split pane horizontally (top/bottom)" },
        { key: KEYS.C, description: "Close current pane" },
        { key: KEYS.CAP_Z, description: "Maximize/restore pane (zoom)" },
      ],
    },
    {
      title: "Layout Persistence",
      items: [
        { key: KEYS.S, description: "Save current layout" },
        { key: KEYS.R, description: "Restore saved layout" },
        { key: KEYS.D, description: "Reset to default layout" },
      ],
    },
    {
      title: "View Navigation",
      items: [
        { key: KEYS.P, description: "Open view picker dialog" },
        { key: KEYS.N, description: "Toggle notification panel" },
        { key: KEYS.M, description: "Toggle memory update notifications" },
        { key: KEYS.QUESTION, description: "Show this help screen" },
      ],
    },
    {
      title: "Available Views",
      items: [
        { key: "🌀 Portal Manager", description: "Manage portal aliases" },
        { key: "📋 Plan Reviewer", description: "Review and approve plans" },
        { key: "📊 Monitor", description: "View system logs" },
        { key: "⚙️ Daemon Control", description: "Manage daemon" },
        { key: "🤖 Agent Roles", description: "View agent role status" },
        { key: "📥 Request Manager", description: "Manage requests" },
        { key: "💾 Memory", description: "Memory management" },
      ],
    },
    {
      title: "Exit",
      items: [
        { key: "Esc/q", description: "Quit dashboard" },
      ],
    },
  ];
}

export function renderViewIndicator(panes: IPane[], activePaneId: string, theme: Theme): string {
  const indicators: string[] = [];

  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i];
    const icon = DASHBOARD_ICONS.views[pane.view.name] || "📦";
    const focusIndicator = pane.id === activePaneId ? DASHBOARD_ICONS.pane.focused : DASHBOARD_ICONS.pane.unfocused;

    const paneLabel = `${focusIndicator} ${i + 1}:${icon}`;

    if (pane.id === activePaneId) {
      indicators.push(colorize(paneLabel, theme.primary, theme.reset));
    } else {
      indicators.push(colorize(paneLabel, theme.textDim, theme.reset));
    }
  }

  return indicators.join("  ");
}

export function renderGlobalHelpOverlay(_theme: Theme): string[] {
  const sections = getDashboardHelpSections();
  return renderHelpScreen({
    title: "Exaix Dashboard Help",
    sections,
    footer: "Press ? or Esc to close help",
    width: 70,
    useColors: true,
  });
}

export function renderPaneTitleBar(pane: IPane, theme: Theme): string {
  const icon = DASHBOARD_ICONS.views[pane.view.name] || "📦";
  const name = pane.view.name.replace("View", "");
  const focusIndicator = pane.focused ? "●" : "○";
  const maxIndicator = pane.maximized ? " [MAX]" : "";

  const title = `${focusIndicator} ${icon} ${name}${maxIndicator}`;

  if (pane.focused) {
    return colorize(title, theme.primary, theme.reset);
  }
  return colorize(title, theme.textDim, theme.reset);
}
