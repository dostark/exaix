/**
 * @module TuiDashboard
 * @path src/tui/tui_dashboard.ts
 * @description Main entry point and orchestrator for the Exaix TUI dashboard, managing layout, view switching, and cross-view state.
 * @architectural-layer TUI
 * @related-files [src/tui/dashboard/renderer.ts, src/tui/agent_status_view.ts, src/tui/daemon_control_view.ts]
 *
 * This is the main entry point for the Exaix TUI, integrating all
 * enhanced views into a unified dashboard with:
 * - Multi-pane split view support
 * - Global help overlay
 * - View switching indicators
 * - Notification system
 * - Layout persistence
 */

import { MessageType } from "@exaix/core";
import type { SplitDirection } from "@exaix/tui";
import type { INotificationService, IPortalService } from "@exaix/core/types";
import {
  TUI_DASHBOARD_ICONS,
  TUI_DASHBOARD_VIEW_PICKER_WIDTH,
  TUI_LAYOUT_DEFAULT_HEIGHT,
  TUI_LAYOUT_FULL_WIDTH,
  TUI_MAIN_PANE_ID,
  TUI_TREE_ICONS,
} from "@exaix/tui/helpers/constants.ts";
import { colorize, getTheme, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";
import { type IKeyBinding, KeyBindingCategory, KEYS } from "@exaix/tui/helpers/keyboard.ts";
import {
  handleMemoryNotifications as _handleMemoryNotifications,
  type IDashboardContext,
  renderNotificationPanel,
} from "@exaix/tui/helpers/notifications.ts";
import type { IPortalInfo } from "@exaix/core/types";
import type { IMemoryNotification } from "@exaix/core/types";
import {
  resetToDefault as helperResetToDefault,
  restoreLayout as helperRestoreLayout,
  saveLayout as helperSaveLayout,
} from "@exaix/tui/layout/persistence.ts";
import { type IHelpSection, renderHelpScreen } from "@exaix/tui/helpers/help_renderer.ts";
import { KeyBindingsBase } from "@exaix/tui/base/key_bindings_base.ts";
import type { IDatabaseService } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";
import { initDashboardViews } from "./dashboard/view_registry.ts";
import { prodRender } from "./dashboard/renderer.ts";

import { type ILayoutPresetDisplay, renderLayoutPresetListLines } from "@exaix/tui/layout/rendering.ts";
import {
  closePane as helperClosePane,
  maximizePane as helperMaximizePane,
  resizePane as helperResizePane,
  splitPane as helperSplitPane,
  switchPane as helperSwitchPane,
} from "@exaix/tui/layout/pane_manager.ts";

// Type alias for convenience
type Theme = ITuiTheme;

// ===== Dashboard Interfaces =====

/**
 * Common interface for all TUI views to ensure consistent orchestration.
 */
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

export interface ITuiDashboard {
  // State
  panes: IPane[];
  activePaneId: string;
  views: ITuiView[];
  state: IDashboardViewState;
  theme: Theme;

  // Test mode handlers (internal routing helpers)
  handleHelpOverlay?: (self: ITuiDashboard, key: string, panes: IPane[]) => number;
  handleViewPicker?: (
    self: ITuiDashboard,
    key: string,
    views: ITuiView[],
    panes: IPane[],
    viewPickerIndexRef: { index: number },
  ) => number;
  handleMemoryNotifications?: (
    self: ITuiDashboard,
    key: string,
    panes: IPane[],
    notificationService: INotificationService,
  ) => Promise<number>;

  // Core methods
  handleKey(key: string): Promise<number>;
  render(): Promise<void>;
  renderStatusBar(): Promise<string>;
  renderViewIndicator(): string;
  renderGlobalHelp(): string[];
  renderNotifications(): Promise<string[]>;
  destroy(): void;

  // IPane management
  splitPane(direction: SplitDirection): Promise<void>;
  closePane(paneId: string): Promise<void>;
  resizePane(paneId: string, deltaWidth: number, deltaHeight: number): void;
  switchPane(paneId: string): void;
  maximizePane(paneId: string): void;
  restorePane(paneId: string): void;

  // Layout persistence
  saveLayout(): Promise<void>;
  restoreLayout(): Promise<void>;
  resetToDefault(): Promise<void>;

  // Notifications
  notificationService: INotificationService;
  notify(message: string, type?: string): Promise<void>;
  dismissNotification(id: string): Promise<void>;
  clearNotifications(): Promise<void>;
  approveMemoryUpdate(proposalId: string): Promise<void>;
  rejectMemoryUpdate(proposalId: string): Promise<void>;

  // Legacy support
  portalManager: {
    service: IPortalService;
    renderPortalList: (portals: IPortalInfo[]) => string;
  };
  accessibility: {
    highContrast: boolean;
    screenReader: boolean;
  };
  keybindings: {
    nextView: string;
    prevView: string;
    notify: string;
    splitVertical: string;
    splitHorizontal: string;
    closePane: string;
  };
}

// ===== Dashboard Icons =====

// Runtime-loaded TUI helpers are imported at module initialization so the dynamic
// dependency is still tracked by the module graph while avoiding imports inside
// nested statements.
// style-exclude:PLUGINS - runtime TUI helper loaded on demand
const handleKeyModulePromise = import("@exaix/tui/helpers/handle_key.ts");
// style-exclude:PLUGINS - runtime TUI helper loaded on demand
const prodHandleKeyModulePromise = import("@exaix/tui/helpers/prod_handle_key.ts");
// style-exclude:RUNTIME_REGISTRY - dynamic std/streams import used in non-tty fallback
const stdStreamsModulePromise = import("@std/streams");

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

// style-exclude:RUNTIME_REGISTRY - Dynamic import is required at runtime to avoid circular dependency and load TUI service factory only when the dashboard is initialized.
const tuiServiceFactoryModule = import("../services/utils/tui_service_factory.ts");

// ===== Dashboard Key Bindings =====

type DashboardAction =
  | "next_pane"
  | "prev_pane"
  | "split_vertical"
  | "split_horizontal"
  | "close_pane"
  | "maximize_pane"
  | "save_layout"
  | "restore_layout"
  | "reset_layout"
  | "show_help"
  | "show_notifications"
  | "show_view_picker"
  | "quit"
  | "view_1"
  | "view_2"
  | "view_3"
  | "view_4"
  | "view_5"
  | "view_6"
  | "view_7"
  | "show_memory_notifications"
  | "resize_left"
  | "resize_right"
  | "resize_up"
  | "resize_down";

export class DashboardKeyBindings extends KeyBindingsBase<DashboardAction> {
  readonly KEY_BINDINGS: readonly IKeyBinding<DashboardAction>[] = [
    // Navigation
    { key: KEYS.TAB, action: "next_pane", description: "Next pane", category: KeyBindingCategory.NAVIGATION },
    { key: KEYS.SHIFT_TAB, action: "prev_pane", description: "Previous pane", category: KeyBindingCategory.NAVIGATION },
    {
      key: KEYS.ONE_TO_SEVEN,
      action: "view_1",
      description: "Jump to pane 1-7",
      category: KeyBindingCategory.NAVIGATION,
    },

    // Layout
    {
      key: KEYS.V,
      action: "split_vertical",
      description: "Split pane vertically",
      category: KeyBindingCategory.LAYOUT,
    },
    {
      key: KEYS.H,
      action: "split_horizontal",
      description: "Split pane horizontally",
      category: KeyBindingCategory.LAYOUT,
    },
    { key: KEYS.C, action: "close_pane", description: "Close current pane", category: KeyBindingCategory.LAYOUT },
    {
      key: KEYS.CAP_Z,
      action: "maximize_pane",
      description: "Maximize/restore pane",
      category: KeyBindingCategory.LAYOUT,
    },
    { key: KEYS.S, action: "save_layout", description: "Save layout", category: KeyBindingCategory.LAYOUT },
    { key: KEYS.R, action: "restore_layout", description: "Restore layout", category: KeyBindingCategory.LAYOUT },
    { key: KEYS.D, action: "reset_layout", description: "Reset to default", category: KeyBindingCategory.LAYOUT },

    // Resizing
    { key: KEYS.CTRL_LEFT, action: "resize_left", description: "Resize left", category: KeyBindingCategory.LAYOUT },
    { key: KEYS.CTRL_RIGHT, action: "resize_right", description: "Resize right", category: KeyBindingCategory.LAYOUT },
    { key: KEYS.CTRL_UP, action: "resize_up", description: "Resize up", category: KeyBindingCategory.LAYOUT },
    { key: KEYS.CTRL_DOWN, action: "resize_down", description: "Resize down", category: KeyBindingCategory.LAYOUT },

    // Dialogs
    { key: KEYS.QUESTION, action: "show_help", description: "Show help", category: KeyBindingCategory.GENERAL },
    {
      key: KEYS.N,
      action: "show_notifications",
      description: "Toggle notifications",
      category: KeyBindingCategory.GENERAL,
    },
    {
      key: KEYS.M,
      action: "show_memory_notifications",
      description: "Memory updates",
      category: KeyBindingCategory.GENERAL,
    },
    { key: KEYS.P, action: "show_view_picker", description: "View picker", category: KeyBindingCategory.GENERAL },
    { key: KEYS.ESC_Q, action: "quit", description: "Quit dashboard", category: KeyBindingCategory.GENERAL },
  ];
}

export const DASHBOARD_KEY_BINDINGS = new DashboardKeyBindings().KEY_BINDINGS;

// ===== Help Sections =====

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
        { key: "🤖 Identities", description: "View identity status" },
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

export function tryEnableRawMode(): boolean {
  try {
    // Define intersection type for Deno.stdin with optional terminal methods
    type StdinWithTerminal = typeof Deno.stdin & { isTerminal?: () => boolean; setRaw?: (mode: boolean) => void };
    const stdin = Deno.stdin as StdinWithTerminal;
    if (typeof stdin.isTerminal === "function" && stdin.isTerminal()) {
      if (typeof stdin.setRaw === "function") {
        stdin.setRaw(true);
        return true;
      }
    }
  } catch (_err) {
    // best-effort: ignore errors
  }
  return false;
}

export function tryDisableRawMode(): boolean {
  try {
    // Define intersection type for Deno.stdin with optional setRaw method
    type StdinWithSetRaw = typeof Deno.stdin & { setRaw?: (mode: boolean) => void };
    const stdin = Deno.stdin as StdinWithSetRaw;
    if (typeof stdin.setRaw === "function") {
      stdin.setRaw(false);
      return true;
    }
  } catch (_err) {
    // ignore
  }
  return false;
}

// Notification helpers are now handled by INotificationService

// ===== Default Dashboard State =====

export function createDefaultDashboardState(): IDashboardViewState {
  return {
    showHelp: false,
    showNotifications: false,
    showViewPicker: false,
    isLoading: false,
    loadingMessage: "",
    error: null,
    currentTheme: "dark",
    highContrast: false,
    screenReader: false,
    showMemoryNotifications: false,
    selectedMemoryNotifIndex: 0,
  };
}

// ===== View Indicator Rendering =====

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

// ===== Global Help Overlay Rendering =====

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

// ===== Notification Panel Rendering =====

// `renderNotificationPanel` and `handleMemoryNotifications` now live in `@exaix/tui/helpers/notifications.ts`.

// ===== View Picker Rendering =====

export function renderViewPicker(
  views: ITuiView[],
  currentViewIndex: number,
  theme: Theme,
): string[] {
  const lines: string[] = [];

  lines.push(colorize("┌────────────────────────────────────┐", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize("          Select View             ", theme.h1, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize("├────────────────────────────────────┤", theme.border, theme.reset));

  const viewDisplays: ILayoutPresetDisplay[] = views.map((view, index) => ({
    name: view.name.replace("View", ""),
    description: "",
    icon: DASHBOARD_ICONS.views[view.name] || TUI_TREE_ICONS.project,
    shortcut: String(index + 1),
  }));

  lines.push(
    ...renderLayoutPresetListLines(
      viewDisplays,
      currentViewIndex,
      theme,
      { width: TUI_DASHBOARD_VIEW_PICKER_WIDTH, includeSuffix: true, showDescription: false },
    ),
  );

  lines.push(colorize("├────────────────────────────────────┤", theme.border, theme.reset));
  lines.push(
    colorize("│", theme.border, theme.reset) +
      colorize(" Enter to select, Esc to cancel   ", theme.textDim, theme.reset) +
      colorize("│", theme.border, theme.reset),
  );
  lines.push(colorize("└────────────────────────────────────┘", theme.border, theme.reset));

  return lines;
}

// ===== IPane Title Bar Rendering =====

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

// Helper handlers extracted from the large dashboard key handler to reduce complexity
function _handleHelpOverlay(self: ITuiDashboard, key: string, panes: IPane[]) {
  if (key === KEYS.QUESTION || key === KEYS.ESCAPE) {
    self.state.showHelp = false;
  }
  return panes.findIndex((p) => p.id === self.activePaneId);
}

async function _handleMemoryNotificationsLocal(
  self: ITuiDashboard & IDashboardContext,
  key: string,
  panes: IPane[],
  notificationService: INotificationService,
) {
  return await _handleMemoryNotifications(self, key, panes, notificationService);
}

function _handleViewPicker(
  self: ITuiDashboard,
  key: string,
  views: ITuiView[],
  panes: IPane[],
  viewPickerIndexRef: { index: number },
) {
  if (key === KEYS.ESCAPE) {
    self.state.showViewPicker = false;
  } else if (key === KEYS.UP || key === KEYS.K) {
    viewPickerIndexRef.index = (viewPickerIndexRef.index - 1 + views.length) % views.length;
  } else if (key === KEYS.DOWN || key === KEYS.J) {
    viewPickerIndexRef.index = (viewPickerIndexRef.index + 1) % views.length;
  } else if (key === KEYS.ENTER) {
    const activePane = panes.find((p) => p.id === self.activePaneId);
    if (activePane) {
      activePane.view = views[viewPickerIndexRef.index];
    }
    self.state.showViewPicker = false;
  } else if (key >= KEYS.ONE && key <= KEYS.SEVEN) {
    const idx = parseInt(key) - 1;
    if (idx < views.length) {
      const activePane = panes.find((p) => p.id === self.activePaneId);
      if (activePane) {
        activePane.view = views[idx];
      }
      self.state.showViewPicker = false;
    }
  }

  return panes.findIndex((p) => p.id === self.activePaneId);
}

export async function launchTuiDashboard(
  options: {
    testMode?: boolean;
    nonInteractive?: boolean;
    notificationService?: INotificationService;
    databaseService?: IDatabaseService;
    config?: Config;
  } = {},
): Promise<ITuiDashboard | undefined> {
  if (options.testMode) {
    return await createTestDashboard(options);
  }

  return await createProductionDashboard(options);
}

/**
 * Internal helper to create a mock notification service for testing
 */
function createMockNotificationService(localNotifs: IMemoryNotification[]): INotificationService {
  return {
    async notify(message: string, type: IMemoryNotification["type"] = "info") {
      localNotifs.unshift({ // Newest first
        id: crypto.randomUUID(),
        type,
        message,
        created_at: new Date().toISOString(),
      });
      await Promise.resolve();
    },
    async getNotifications() {
      return await Promise.resolve(localNotifs.filter((n) => !n.dismissed_at));
    },
    async getPendingCount() {
      return await Promise.resolve(localNotifs.filter((n) => !n.dismissed_at).length);
    },
    async notifyPendingDigestIfNeeded() {
      return await Promise.resolve(false);
    },
    notifyMemoryUpdate: async () => {},
    notifyApproval: async () => {},
    notifyRejection: async () => {},
    async clearNotification(id: string) {
      const notif = localNotifs.find((n) => n.id === id);
      if (notif) notif.dismissed_at = new Date().toISOString();
      await Promise.resolve();
    },
    async clearAllNotifications() {
      localNotifs.forEach((n) => n.dismissed_at = new Date().toISOString());
      await Promise.resolve();
    },
    database: {} as IDatabaseService,
  } as INotificationService;
}

/**
 * Creates a test-mode dashboard with mocked services and simplified behavior.
 */
function createTestDashboard(options: {
  notificationService?: INotificationService;
  databaseService?: IDatabaseService;
  config?: Config;
}): ITuiDashboard {
  // Initialize views using registry
  const { views, services } = initDashboardViews({
    testMode: true,
    databaseService: options.databaseService,
    config: options.config,
  });
  const portalView = views[0];
  // If needed, check type at runtime:
  // if (!(portalView instanceof PortalManagerView)) {
  //   throw new Error("views[0] is not a PortalManagerView");
  // }
  const portalService = services.portalService;

  // Initialize with single pane
  const initialPane: IPane = {
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
  };
  const panes: IPane[] = [initialPane];
  const activePaneId = TUI_MAIN_PANE_ID;

  // Initialize state
  const state: IDashboardViewState = createDefaultDashboardState();
  const theme: Theme = getTheme(true);

  // View picker state
  let viewPickerIndex = 0;

  // Initialize notification service if not provided
  const localNotifs: IMemoryNotification[] = [];
  const notificationService = options.notificationService || createMockNotificationService(localNotifs);

  return {
    panes,
    activePaneId,
    views,
    state,
    theme,
    notificationService,
    // Expose extracted helpers so test-mode key handler can call them
    handleHelpOverlay: _handleHelpOverlay,
    handleViewPicker: _handleViewPicker,
    handleMemoryNotifications: _handleMemoryNotificationsLocal,
    async handleKey(key: string) {
      const viewPickerRef = { index: viewPickerIndex };
      const handleKeyModule: {
        testModeHandleKey: typeof import("@exaix/tui/helpers/handle_key.ts").testModeHandleKey;
      } = await handleKeyModulePromise;
      const idx = handleKeyModule.testModeHandleKey(this, key, panes, views, viewPickerRef);
      viewPickerIndex = viewPickerRef.index;
      // Check for Deno global in test debug mode
      type TuiGlobalWithDeno = typeof globalThis & { Deno?: { env: { get(k: string): string | undefined } } };
      const globalWithDenoTui = globalThis as TuiGlobalWithDeno;
      if (
        typeof globalWithDenoTui.Deno !== "undefined" &&
        globalWithDenoTui.Deno?.env.get("EXA_TEST_LOG_TAB_DEBUG") === "1"
      ) {
        console.debug("[TUI][DEBUG] launch.handleKey returned active=", this.activePaneId);
      }
      // Stabilize state: allow any queued tasks to run before returning to tests
      await new Promise((res) => setTimeout(res, 0));
      return idx;
    },
    async render() {
      // Test mode render - does nothing
    },
    async renderStatusBar() {
      const activePane = panes.find((p) => p.id === this.activePaneId);
      const indicator = renderViewIndicator(panes, this.activePaneId, this.theme);
      const notificationCount = await this.notificationService.getPendingCount();
      const notificationBadge = notificationCount > 0 ? ` 🔔${notificationCount}` : "";
      return `${indicator} │ Active: ${activePane?.view.name}${notificationBadge}`;
    },
    renderViewIndicator() {
      return renderViewIndicator(panes, this.activePaneId, this.theme);
    },
    renderGlobalHelp() {
      return renderGlobalHelpOverlay(this.theme);
    },
    async renderNotifications() {
      return await renderNotificationPanel(this.notificationService, this.theme, this.state);
    },
    async approveMemoryUpdate(_proposalId: string) {
      await this.notify("Memory update approved (test)", MessageType.SUCCESS);
    },
    async rejectMemoryUpdate(_proposalId: string) {
      await this.notify("Memory update rejected (test)", MessageType.ERROR);
    },
    portalManager: {
      service: portalService,
      renderPortalList: (portals: IPortalInfo[]) => {
        // Type guard for renderPortalList
        if (typeof portalView === "object" && portalView !== null && "renderPortalList" in portalView) {
          const fn = (portalView as { renderPortalList?: (portals: IPortalInfo[]) => string }).renderPortalList;
          if (typeof fn === "function") {
            return fn(portals);
          }
        }
        return "";
      },
    },
    async notify(message: string, type = MessageType.INFO) {
      await this.notificationService.notify(message, type);
    },
    async dismissNotification(id: string) {
      await this.notificationService.clearNotification(id);
    },
    async clearNotifications() {
      await this.notificationService.clearAllNotifications();
    },
    accessibility: {
      highContrast: false,
      screenReader: false,
    },
    keybindings: {
      nextView: KEYS.TAB,
      prevView: KEYS.SHIFT_TAB,
      notify: KEYS.N,
      splitVertical: KEYS.V,
      splitHorizontal: KEYS.H,
      closePane: KEYS.C,
    },
    async splitPane(direction: SplitDirection) {
      const result = await helperSplitPane(panes, this.activePaneId, views, direction, this.notify.bind(this));
      this.activePaneId = result.activePaneId;
    },
    async closePane(paneId: string) {
      const result = await helperClosePane(panes, this.activePaneId, paneId, this.notify.bind(this));
      this.activePaneId = result.activePaneId;
    },
    resizePane(paneId: string, deltaWidth: number, deltaHeight: number) {
      helperResizePane(panes, paneId, deltaWidth, deltaHeight);
    },
    switchPane(paneId: string) {
      const newId = helperSwitchPane(panes, paneId);
      if (newId) this.activePaneId = newId;
    },
    maximizePane(paneId: string) {
      helperMaximizePane(panes, paneId, this.notify.bind(this));
    },
    restorePane(paneId: string) {
      const pane = panes.find((p) => p.id === paneId);
      if (pane && pane.maximized) {
        this.maximizePane(paneId);
      }
    },
    saveLayout() {
      // Mock save - in production this would write to file
      // For testing, we can override this method
      return Promise.resolve();
    },
    restoreLayout() {
      // Mock restore - in production this would read from file
      // For testing, we can override this method
      return Promise.resolve();
    },
    async resetToDefault() {
      // Reset to single pane with PortalManagerView
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
      this.activePaneId = TUI_MAIN_PANE_ID;
      await this.clearNotifications();
      await this.notify("Layout reset to default", MessageType.INFO);
    },
    destroy() {
      // Clean up all views to prevent interval leaks in tests
      for (const view of views) {
        if (typeof view.dispose === "function") {
          view.dispose();
        } else if (typeof view.destroy === "function") {
          view.destroy();
        }
      }
    },
  } as ITuiDashboard;
}

/**
 * Creates a production-mode dashboard with full TUI functionality.
 * This reduces the complexity of the main launchTuiDashboard function by extracting
 * all production-specific initialization and interactive loop logic.
 */
async function createProductionDashboard(options: {
  nonInteractive?: boolean;
  notificationService?: INotificationService;
  databaseService?: IDatabaseService;
  config?: Config;
}): Promise<ITuiDashboard | undefined> {
  // Validate required options
  if (!options.config || !options.databaseService) {
    console.error("Production dashboard requires config and databaseService");
    return undefined;
  }

  // Create services using core factory (this is the boundary crossing point)
  const { createTuiServices } = await tuiServiceFactoryModule;
  const serviceBundle = createTuiServices({
    config: options.config,
    databaseService: options.databaseService,
  });

  // Initialize views using registry with pre-created services
  const { views, services } = initDashboardViews({
    testMode: false,
    services: serviceBundle,
  });
  const _portalView = views[0];
  const portalService = services.portalService;

  // Initialize with single pane
  const initialPane: IPane = {
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
  };
  const panes: IPane[] = [initialPane];
  let activePaneId = TUI_MAIN_PANE_ID;

  // Initialize state
  const _state: IDashboardViewState = createDefaultDashboardState();
  const theme: Theme = getTheme(true);

  // Production state
  // Initialize services for production
  const _db = {} as Record<string, never>; // TODO: Initialize real DB service
  const notificationService = options.notificationService || {
    async notifyMemoryUpdate() {
      await Promise.resolve();
    },
    async getNotifications() {
      return await Promise.resolve([]);
    },
    async getPendingCount() {
      return await Promise.resolve(0);
    },
    async notifyPendingDigestIfNeeded() {
      return await Promise.resolve(false);
    },
    async notify() {
      await Promise.resolve();
    },
    notifyApproval() {},
    notifyRejection() {},
    async clearNotification() {
      await Promise.resolve();
    },
    async clearAllNotifications() {
      await Promise.resolve();
    },
    database: {} as IDatabaseService,
  } as INotificationService;

  const prodState: IDashboardViewState = createDefaultDashboardState();

  // Helper to add notification (accepts generic string to match helper signature)
  const addNotification = async (message: string, type?: string) => {
    const t = type ?? MessageType.INFO;
    console.log(`[${t}] ${message}`);
    await Promise.resolve();
  };

  // Layout persistence delegated to helper module
  const saveLayout = async () => await helperSaveLayout(panes, activePaneId, addNotification);
  const restoreLayout = async () => {
    const result = await helperRestoreLayout(panes, views, addNotification);
    if (result?.activePaneId) activePaneId = result.activePaneId;
  };
  const resetToDefault = () => {
    const newId = helperResetToDefault(panes, views, addNotification);
    activePaneId = newId;
  };

  // Restore layout on startup
  await restoreLayout();

  console.clear();
  console.log("Exaix TUI Dashboard");
  console.log("======================");

  async function prodRenderWrapper() {
    await prodRender(
      panes,
      activePaneId,
      prodState,
      theme,
      notificationService,
      portalService,
    );
  }
  const render = prodRenderWrapper;
  await render();

  if (!options.nonInteractive) {
    await runProductionInteractiveLoop({
      panes,
      activePaneId: { value: activePaneId },
      views,
      prodState,
      theme,
      notificationService,
      addNotification,
      saveLayout,
      restoreLayout,
      resetToDefault,
      render,
    });
    activePaneId = { value: activePaneId }.value;
  }

  // Save layout on exit
  await saveLayout();

  console.log("Exiting dashboard.");

  // Production mode doesn't return a dashboard object
  return undefined;
}

/**
 * Runs the production interactive loop with raw mode or line-based input.
 * This extracts the complex interactive loop logic from the main function.
 */
async function runProductionInteractiveLoop(context: {
  panes: IPane[];
  activePaneId: { value: string };
  views: ITuiView[];
  prodState: IDashboardViewState;
  theme: Theme;
  notificationService: INotificationService;
  addNotification: (message: string, type?: string) => Promise<void>;
  saveLayout: () => Promise<void>;
  restoreLayout: () => Promise<void>;
  resetToDefault: () => void;
  render: () => Promise<void>;
}): Promise<void> {
  // Interactive mode: attempt to enable raw mode when possible and provide a line-based fallback
  let rawEnabled = false;
  try {
    type StdinWithIsTerminal = typeof Deno.stdin & { isTerminal?: () => boolean };
    const stdin = Deno.stdin as StdinWithIsTerminal;
    const isTty = typeof stdin.isTerminal === "function" && stdin.isTerminal();
    if (isTty) {
      rawEnabled = tryEnableRawMode();
      if (!rawEnabled) console.warn("Warning: terminal raw mode not available; keyboard keys will require Enter.");
    } else {
      console.log("Non-tty stdin detected; using line-based input (press Enter after commands).");
    }

    const decoder = new TextDecoder();

    if (rawEnabled) {
      // Raw-mode loop - immediate key sequences
      for await (const chunk of Deno.stdin.readable) {
        const input = decoder.decode(chunk);
        const key = input; // preserve escape sequences

        const prodHandleKeyModule: {
          prodHandleKey: typeof import("@exaix/tui/helpers/prod_handle_key.ts").prodHandleKey;
        } = await prodHandleKeyModulePromise;
        const res = await prodHandleKeyModule.prodHandleKey(key, {
          prodState: context.prodState,
          panes: context.panes,
          views: context.views,
          activePaneRef: { id: context.activePaneId.value },
          notificationService: context.notificationService,
          addNotification: context.addNotification,
          saveLayout: context.saveLayout,
          restoreLayout: context.restoreLayout,
          resetToDefault: context.resetToDefault,
        });

        context.activePaneId.value = { id: context.activePaneId.value }.id;
        if (res?.exit) break;
        if (res?.reRender) await context.render();
        continue;
      }
    } else {
      // Non-raw fallback: read lines from stdin (Enter-terminated commands)
      const streamsMod: { TextLineStream: typeof import("@std/streams").TextLineStream } =
        await stdStreamsModulePromise;
      for await (
        const line of Deno.stdin.readable.pipeThrough(new TextDecoderStream()).pipeThrough(
          new streamsMod.TextLineStream(),
        )
      ) {
        const cmd = line.trim().toLowerCase();
        if (!cmd) continue;

        const prodHandleKeyModule: {
          prodHandleKey: typeof import("@exaix/tui/helpers/prod_handle_key.ts").prodHandleKey;
        } = await prodHandleKeyModulePromise;
        const res = await prodHandleKeyModule.prodHandleKey(cmd, {
          prodState: context.prodState,
          panes: context.panes,
          views: context.views,
          activePaneRef: { id: context.activePaneId.value },
          notificationService: context.notificationService,
          addNotification: context.addNotification,
          saveLayout: context.saveLayout,
          restoreLayout: context.restoreLayout,
          resetToDefault: context.resetToDefault,
        });

        context.activePaneId.value = { id: context.activePaneId.value }.id;
        if (res?.exit) break;
        if (res?.reRender) await context.render();
      }
    }
  } finally {
    if (rawEnabled) {
      tryDisableRawMode();
    }
  }
}

if (import.meta.main) {
  launchTuiDashboard();
}
