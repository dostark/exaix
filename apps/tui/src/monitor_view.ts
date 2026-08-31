/**
 * @module MonitorView
 * @path apps/tui/src/monitor_view.ts
 * @description TUI log monitoring view with advanced filtering, grouping, and bookmarking capabilities for real-time log analysis.
 * @architectural-layer TUI
 * @related-files ["@exaix/core/types", apps/tui/src/tui_dashboard.ts]
 */

import { BaseTreeView } from "@exaix/tui/base/base_tree_view.ts";
import { KeyBindingsBase } from "@exaix/tui/base/key_bindings_base.ts";
import { createGroupNode, createNode, getFirstNodeId, type ITreeNode } from "@exaix/tui/helpers/tree_view.ts";
import { type IHelpSection, renderHelpScreen } from "@exaix/tui/helpers/help_renderer.ts";
import type { DialogBase } from "@exaix/tui/helpers/dialog_base.ts";
import { type IKeyBinding, KeyBindingCategory, KEYS } from "@exaix/tui/helpers/keyboard.ts";
import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types";
import { DialogStatus } from "@exaix/core";
import { GroupingMode } from "@exaix/tui";
import type { JSONObject } from "@exaix/core/types";
import type { IJournalService } from "@exaix/core/types";
import { LOG_COLORS, LOG_ICONS, MONITOR_AUTO_REFRESH_INTERVAL_MS } from "@exaix/tui/config.ts";
import {
  TUI_ACTION_SEARCH,
  TUI_ELEMENT_ACTION_BUTTONS,
  TUI_KEY_LABEL_ENTER,
  TUI_LAYOUT_NARROW_WIDTH,
} from "@exaix/tui/helpers/constants.ts";
import { TUI_SECTION } from "@exaix/tui/helpers/decorations.ts";

export interface ILogEntry {
  id: string;
  trace_id: string;
  actor: string | null;
  actor_type: string | null;
  identity_id: string | null;
  agent_kind?: string | null;
  action_type: string;
  target: string | null;
  payload: JSONObject;
  timestamp: string;
}

// View State

export interface ILogViewExtensions {
  /** Whether detail view is shown */
  showDetail: boolean;
  /** Detail content for expanded log */
  detailContent: string;
  /** Bookmarked log IDs */
  bookmarkedIds: Set<string>;
  groupBy: GroupingMode;
}

export enum MonitorViewAction {
  NAVIGATE_UP = "navigate-up",
  NAVIGATE_DOWN = "navigate-down",
  NAVIGATE_HOME = "navigate-home",
  NAVIGATE_END = "navigate-end",
  COLLAPSE = "collapse",
  EXPAND = "expand",
  VIEW_DETAILS = "view-details",
  TOGGLE_PAUSE = "toggle-pause",
  BOOKMARK = "bookmark",
  EXPORT = "export",
  SEARCH = "search",
  FILTER_IDENTITY = "filter-identity",
  FILTER_TIME = "filter-time",
  FILTER_TRACE = "filter-trace",
  FILTER_ACTION = "filter-action",
  TOGGLE_GROUPING = "toggle-grouping",
  REFRESH = "refresh",
  AUTO_REFRESH = "auto-refresh",
  COLLAPSE_ALL = "collapse-all",
  EXPAND_ALL = "expand-all",
  HELP = "help",
  QUIT = "quit",
  CANCEL = "cancel",
}

export class MonitorViewBindings extends KeyBindingsBase<MonitorViewAction, KeyBindingCategory> {
  readonly KEY_BINDINGS: readonly IKeyBinding<MonitorViewAction, KeyBindingCategory>[] = [
    {
      key: KEYS.UP,
      action: MonitorViewAction.NAVIGATE_UP,
      description: "Move up",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.DOWN,
      action: MonitorViewAction.NAVIGATE_DOWN,
      description: "Move down",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.HOME,
      action: MonitorViewAction.NAVIGATE_HOME,
      description: "Go to first",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.END,
      action: MonitorViewAction.NAVIGATE_END,
      description: "Go to last",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.LEFT,
      action: MonitorViewAction.COLLAPSE,
      description: "Collapse group",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.RIGHT,
      action: MonitorViewAction.EXPAND,
      description: "Expand group",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.ENTER,
      action: MonitorViewAction.VIEW_DETAILS,
      description: "View log details",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.SPACE,
      action: MonitorViewAction.TOGGLE_PAUSE,
      description: "Toggle pause",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.B,
      action: MonitorViewAction.BOOKMARK,
      description: "Bookmark entry",
      category: KeyBindingCategory.ACTIONS,
    },
    { key: KEYS.E, action: MonitorViewAction.EXPORT, description: "Export logs", category: KeyBindingCategory.ACTIONS },
    { key: KEYS.S, action: MonitorViewAction.SEARCH, description: "Search logs", category: KeyBindingCategory.ACTIONS },
    {
      key: KEYS.F,
      action: MonitorViewAction.FILTER_IDENTITY,
      description: "Filter by identity",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.T,
      action: MonitorViewAction.FILTER_TIME,
      description: "Filter by time",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.CAP_T,
      action: MonitorViewAction.FILTER_TRACE,
      description: "Filter by Trace ID",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.CAP_A,
      action: MonitorViewAction.FILTER_ACTION,
      description: "Filter by Action Type",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.G,
      action: MonitorViewAction.TOGGLE_GROUPING,
      description: "Toggle grouping",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.CAP_R,
      action: MonitorViewAction.REFRESH,
      description: "Force refresh",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.A,
      action: MonitorViewAction.AUTO_REFRESH,
      description: "Toggle auto-refresh",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.C,
      action: MonitorViewAction.COLLAPSE_ALL,
      description: "Collapse all",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.CAP_E,
      action: MonitorViewAction.EXPAND_ALL,
      description: "Expand all",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.QUESTION,
      action: MonitorViewAction.HELP,
      description: "Toggle help",
      category: KeyBindingCategory.HELP,
    },
    { key: KEYS.Q, action: MonitorViewAction.QUIT, description: "Close/Back", category: KeyBindingCategory.HELP },
    {
      key: KEYS.ESCAPE,
      action: MonitorViewAction.CANCEL,
      description: "Close dialog/view",
      category: KeyBindingCategory.HELP,
    },
  ];
}

export const MONITOR_KEY_BINDINGS = new MonitorViewBindings().KEY_BINDINGS;

// Monitor View Class

/**
 * View/controller for monitoring logs. Delegates to injected LogService.
 */
export class MonitorView {
  private filter: IJournalFilterOptions = {};
  private isPaused = false;
  private logs: ILogEntry[] = [];

  constructor(private readonly logService: IJournalService) {
    this.refreshLogs();
  }

  /** Refresh logs from the service. */
  async refreshLogs(): Promise<void> {
    if (!this.isPaused) {
      const activities = await this.logService.query(this.filter);
      this.logs = activities.map((log: IActivityRecord): ILogEntry => ({
        ...log,
        payload: (typeof log.payload === "string" ? JSON.parse(log.payload) : log.payload) as JSONObject,
        agent_kind: log.agent_kind ?? null,
      }));
    }
  }

  /** Get all current logs. */
  async getLogs(): Promise<ILogEntry[]> {
    await this.refreshLogs();
    return [...this.logs];
  }

  /** Set the filter for logs. */
  setFilter(filter: IJournalFilterOptions): void {
    this.filter = { ...this.filter, ...filter };
  }

  /** Get filtered logs (DB filtering is applied on refresh). */
  getFilteredLogs(): ILogEntry[] {
    // DB handles structural filtering (agent, action, trace)
    // Client only needs to handle textual search if applied later in TUI session
    return this.logs;
  }

  /** Pause log streaming. */
  pause(): void {
    this.isPaused = true;
  }

  /** Resume log streaming. */
  resume(): void {
    this.isPaused = false;
    this.refreshLogs();
  }

  /** Check if streaming is active. */
  isStreaming(): boolean {
    return !this.isPaused;
  }

  /**
   * Export logs to string format
   */
  exportLogs(): string {
    const logs = this.getFilteredLogs();
    return logs.map((log) => {
      return `${log.timestamp} [${log.actor || "unknown"}] ${log.action_type}: ${log.target || ""} ${
        JSON.stringify(log.payload)
      }`;
    }).join("\n");
  }

  /**
   * Get color for log level based on action type
   */
  getLogColor(actionType: string): string {
    return LOG_COLORS[actionType] || LOG_COLORS["default"];
  }

  /**
   * Render logs for TUI display
   */
  renderLogs(): string {
    const logs = this.getFilteredLogs();
    return logs.map((log) => {
      const color = this.getLogColor(log.action_type);
      return `\x1b[${this.getAnsiColorCode(color)}m${log.timestamp} [${log.actor || "unknown"}] ${log.action_type}: ${
        log.target || ""
      }\x1b[0m`;
    }).join("\n");
  }

  /**
   * Get ANSI color code
   */
  public getAnsiColorCode(color: string): number {
    switch (color) {
      case "red":
        return 31;
      case "green":
        return 32;
      case "yellow":
        return 33;
      case "blue":
        return 34;
      case "white":
      default:
        return 37;
    }
  }

  /**
   * Create TUI session for interactive mode
   */
  createTuiSession(useColors = true): MonitorTuiSession {
    return new MonitorTuiSession(this, useColors);
  }
}

// Minimal Mock for Tests

/**
 * Minimal LogService mock for TUI session tests
 */
export class MinimalLogServiceMock implements IJournalService {
  private logs: ILogEntry[] = [];

  constructor(logs: ILogEntry[] = []) {
    this.logs = logs;
  }

  query(filter: IJournalFilterOptions): Promise<IActivityRecord[]> {
    let filtered = this.logs;

    if (filter.identityId) {
      filtered = filtered.filter((l) => l.identity_id === filter.identityId);
    }
    if (filter.actionType) {
      filtered = filtered.filter((l) => l.action_type === filter.actionType);
    }
    if (filter.traceId) {
      filtered = filtered.filter((l) => l.trace_id === filter.traceId);
    }

    return Promise.resolve([...filtered.map((log) => ({
      ...log,
      payload: JSON.stringify(log.payload),
      actor_type: log.actor_type ?? null,
      identity_id: log.identity_id ?? null,
      agent_kind: log.agent_kind ?? null,
    }))]);
  }

  setLogs(logs: ILogEntry[]): void {
    this.logs = logs;
  }

  getDistinctValues(_field: string): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/**
 * Interactive TUI session for Monitor View
 */
export class MonitorTuiSession extends BaseTreeView<ILogEntry> {
  public readonly monitorView: MonitorView;
  protected logViewExtensions: ILogViewExtensions;
  public autoRefreshTimer: number | null = null;
  // Track what dialog is pending
  public pendingDialogType: "search" | "filter-identity" | "filter-time" | "filter-trace" | "filter-action" | null =
    null;

  constructor(monitorView: MonitorView, useColors = true) {
    super(useColors);
    this.monitorView = monitorView;
    this.logViewExtensions = {
      showDetail: false,
      detailContent: "",
      bookmarkedIds: new Set(),
      groupBy: GroupingMode.NONE,
    };
    // Build tree synchronously for immediate access
    this.buildTree();
    this.selectFirstLog();
  }

  // State Accessors

  override getViewName(): string {
    return "Monitor";
  }

  getLogTree(): ITreeNode[] {
    return this.state.tree;
  }

  isDetailVisible(): boolean {
    return this.logViewExtensions.showDetail;
  }

  getDetailContent(): string {
    return this.logViewExtensions.detailContent;
  }

  getSearchQuery(): string {
    return this.state.filterText;
  }

  getBookmarkedIds(): Set<string> {
    return this.logViewExtensions.bookmarkedIds;
  }

  getGroupBy(): GroupingMode {
    return this.logViewExtensions.groupBy;
  }

  isAutoRefreshEnabled(): boolean {
    return this.state.refreshConfig.enabled;
  }

  override getKeyBindings(): IKeyBinding[] {
    return [...MONITOR_KEY_BINDINGS];
  }

  isPaused(): boolean {
    return !this.monitorView.isStreaming();
  }

  // Tree Building

  protected override buildTree(items: ILogEntry[] = []): void {
    const logs = items.length > 0 ? items : this.monitorView.getFilteredLogs();

    if (this.logViewExtensions.groupBy === GroupingMode.NONE) {
      // Flat list
      this.state.tree = logs.map((log) => {
        const icon = LOG_ICONS[log.action_type as keyof typeof LOG_ICONS] || LOG_ICONS["default"];
        const label = `${icon} ${this.formatTimestamp(log.timestamp)} ${log.action_type}`;
        return createNode<ILogEntry>(log.id, label, "log", { expanded: true });
      });
    } else if (this.logViewExtensions.groupBy === GroupingMode.IDENTITY) {
      // Group by identity
      const byIdentity = new Map<string, ILogEntry[]>();
      for (const log of logs) {
        const identity = log.identity_id || "unknown";
        if (!byIdentity.has(identity)) {
          byIdentity.set(identity, []);
        }
        byIdentity.get(identity)!.push(log);
      }

      this.state.tree = Array.from(byIdentity.entries()).map(([identity, identityLogs]) => {
        const children = identityLogs.map((log) => {
          const icon = LOG_ICONS[log.action_type as keyof typeof LOG_ICONS] || LOG_ICONS["default"];
          const label = `${icon} ${this.formatTimestamp(log.timestamp)} ${log.action_type}`;
          return createNode<ILogEntry>(log.id, label, "log", { expanded: true });
        });
        return createGroupNode<ILogEntry>(
          `identity-${identity}`,
          `🤖 ${identity} (${identityLogs.length})`,
          "identity-group",
          children,
        );
      });
    } else if (this.logViewExtensions.groupBy === GroupingMode.ACTION) {
      // Group by action type
      const byAction = new Map<string, ILogEntry[]>();
      for (const log of logs) {
        if (!byAction.has(log.action_type)) {
          byAction.set(log.action_type, []);
        }
        byAction.get(log.action_type)!.push(log);
      }

      this.state.tree = Array.from(byAction.entries()).map(([action, actionLogs]) => {
        const icon = LOG_ICONS[action as keyof typeof LOG_ICONS] || LOG_ICONS["default"];
        const children = actionLogs.map((log) => {
          const label = `${this.formatTimestamp(log.timestamp)} [${log.identity_id || "unknown"}]`;
          return createNode<ILogEntry>(log.id, label, "log", { expanded: true });
        });
        return createGroupNode<ILogEntry>(
          `action-${action}`,
          `${icon} ${action} (${actionLogs.length})`,
          "action-group",
          children,
        );
      });
    }
  }

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  private selectFirstLog(): void {
    const firstId = getFirstNodeId(this.state.tree);
    if (firstId) {
      this.state.selectedId = firstId;
    }
  }

  // Rendering

  renderLogTree(): string[] {
    if (this.state.tree.length === 0) {
      return ["  (No logs available)"];
    }

    return this.renderTreeView({
      selectedId: this.state.selectedId || undefined,
    });
  }

  renderDetail(): string[] {
    const lines: string[] = [];
    lines.push(TUI_SECTION.TOP);
    lines.push(`║${"LOG DETAILS".padStart(37).padEnd(61)}║`);
    lines.push(TUI_SECTION.MIDDLE);

    if (this.logViewExtensions.detailContent) {
      const contentLines = this.logViewExtensions.detailContent.split("\n");
      for (const line of contentLines) {
        lines.push(`║ ${line.padEnd(63)} ║`);
      }
    } else {
      lines.push("║  (No details available)                                        ║");
    }

    lines.push(TUI_SECTION.BOTTOM);
    lines.push("");
    lines.push("[ESC] Close details");
    return lines;
  }

  renderHelp(): string[] {
    const sections: IHelpSection[] = [
      {
        title: "Navigation",
        items: [
          { key: "↑/↓", description: "Move selection" },
          { key: "Home/End", description: "Jump to first/last" },
          { key: "←/→", description: "Collapse/Expand" },
          { key: "c/E", description: "Collapse/Expand all" },
        ],
      },
      {
        title: "Actions",
        items: [
          { key: TUI_KEY_LABEL_ENTER, description: "View log details" },
          { key: "Space", description: "Toggle pause" },
          { key: "b", description: "Bookmark entry" },
          { key: "e", description: "Export logs" },
          { key: "s", description: "Search logs" },
          { key: "f", description: "Filter by identity" },
          { key: "t", description: "Filter by time" },
          { key: "T", description: "Filter by Trace ID" },
          { key: "A", description: "Filter by Action Type" },
        ],
      },
      {
        title: "View",
        items: [
          { key: "g", description: "Toggle grouping" },
          { key: "R", description: "Force refresh" },
          { key: "a", description: "Toggle auto-refresh" },
          { key: "?", description: "Toggle help" },
          { key: "Esc", description: "Close/Cancel" },
        ],
      },
    ];

    return renderHelpScreen({
      title: "Monitor View Help",
      sections,
      useColors: this.useColors,
      width: TUI_LAYOUT_NARROW_WIDTH,
    });
  }

  renderActionButtons(): string[] {
    const parts: string[] = [];
    parts.push(`[Space] ${this.isPaused() ? "Resume" : "Pause"}`);
    parts.push("[b] Bookmark");
    parts.push("[s] Search");
    parts.push("[g] Group");
    parts.push("[R] Refresh");
    parts.push("[?] Help");
    return parts;
  }

  renderStatusLine(): string {
    const logs = this.monitorView.getFilteredLogs();
    const paused = this.isPaused() ? " [PAUSED]" : "";
    const autoRefresh = this.state.refreshConfig.enabled ? " [AUTO]" : "";
    const bookmarks = this.logViewExtensions.bookmarkedIds.size > 0
      ? ` [${this.logViewExtensions.bookmarkedIds.size} bookmarked]`
      : "";
    const grouping = this.logViewExtensions.groupBy !== GroupingMode.NONE
      ? ` [Group: ${this.logViewExtensions.groupBy}]`
      : "";
    return `${logs.length} logs${paused}${autoRefresh}${bookmarks}${grouping}`;
  }

  // Actions

  showLogDetail(logId: string): void {
    this.setLoading(true, "Loading details...");
    try {
      const logs = this.monitorView.getFilteredLogs();
      const log = logs.find((l) => l.id === logId);
      if (log) {
        this.logViewExtensions.detailContent = this.formatLogDetail(log);
        this.logViewExtensions.showDetail = true;
      }
    } finally {
      this.setLoading(false);
    }
  }

  private formatLogDetail(log: ILogEntry): string {
    const lines: string[] = [];
    lines.push(`ID: ${log.id}`);
    lines.push(`Trace ID: ${log.trace_id}`);
    lines.push(`Timestamp: ${log.timestamp}`);
    lines.push(`Actor: ${log.actor || "unknown"}`);
    lines.push(`Identity: ${log.identity_id || "(none)"}`);
    lines.push(`Action: ${log.action_type}`);
    lines.push(`Target: ${log.target || "(none)"}`);
    lines.push("");
    lines.push("Payload:");
    lines.push(JSON.stringify(log.payload, null, 2));
    return lines.join("\n");
  }

  togglePause(): void {
    if (this.monitorView.isStreaming()) {
      this.monitorView.pause();
      this.statusMessage = "Log streaming paused";
    } else {
      this.monitorView.resume();
      this.buildTree();
      this.statusMessage = "Log streaming resumed";
    }
  }

  toggleBookmark(): void {
    const selectedId = this.state.selectedId;
    if (!selectedId) return;

    // Skip group nodes
    if (selectedId.startsWith("identity-") || selectedId.startsWith("action-")) {
      return;
    }

    if (this.logViewExtensions.bookmarkedIds.has(selectedId)) {
      this.logViewExtensions.bookmarkedIds.delete(selectedId);
      this.statusMessage = "Bookmark removed";
    } else {
      this.logViewExtensions.bookmarkedIds.add(selectedId);
      this.statusMessage = "Log bookmarked";
    }
  }

  isBookmarked(logId: string): boolean {
    return this.logViewExtensions.bookmarkedIds.has(logId);
  }

  toggleGrouping(): void {
    if (this.logViewExtensions.groupBy === GroupingMode.NONE) {
      this.logViewExtensions.groupBy = GroupingMode.IDENTITY;
    } else if (this.logViewExtensions.groupBy === GroupingMode.IDENTITY) {
      this.logViewExtensions.groupBy = GroupingMode.ACTION;
    } else {
      this.logViewExtensions.groupBy = GroupingMode.NONE;
    }
    this.buildTree();
    this.selectFirstLog();
    this.statusMessage = `Grouping: ${this.logViewExtensions.groupBy}`;
  }

  toggleAutoRefresh(): void {
    this.state.refreshConfig.enabled = !this.state.refreshConfig.enabled;
    if (this.state.refreshConfig.enabled) {
      this.startAutoRefresh();
      this.statusMessage = "Auto-refresh enabled";
    } else {
      this.stopAutoRefresh();
      this.statusMessage = "Auto-refresh disabled";
    }
  }

  override startAutoRefresh(): void {
    if (this.autoRefreshTimer) return;
    const timerId = setInterval(() => {
      if (!this.isPaused()) {
        this.doRefresh();
      }
    }, MONITOR_AUTO_REFRESH_INTERVAL_MS);
    this.autoRefreshTimer = Number(timerId);
  }

  override stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  private async doRefresh(): Promise<void> {
    await this.monitorView.refreshLogs();
    this.buildTree();
    this.statusMessage = "Logs refreshed";
  }

  override refresh(): Promise<void> {
    this.doRefresh();
    return Promise.resolve();
  }

  exportLogs(): string {
    const exported = this.monitorView.exportLogs();
    this.statusMessage = `Exported ${this.monitorView.getFilteredLogs().length} logs`;
    return exported;
  }

  showSearchDialog(): void {
    this.pendingDialogType = TUI_ACTION_SEARCH;
    this.showInputDialog({
      title: "Search Logs",
      label: "Enter search query:",
      defaultValue: this.state.filterText,
    });
  }

  showFilterByIdentityDialog(): void {
    const logs = this.monitorView.getFilteredLogs();
    const identities = [...new Set(logs.map((l) => l.identity_id).filter(Boolean))];
    const identityList = identities.length > 0 ? identities.join(", ") : "(no identities)";

    this.pendingDialogType = "filter-identity";
    this.showInputDialog({
      title: "Filter by Identity",
      label: `Available identities: ${identityList}\nEnter identity ID (empty to clear):`,
      defaultValue: "",
    });
  }

  showTimeFilterDialog(): void {
    this.pendingDialogType = "filter-time";
    this.showInputDialog({
      title: "Filter by Time",
      label: "Enter time window in minutes (empty to clear):",
      defaultValue: "",
    });
  }

  showFilterByTraceIdDialog(): void {
    this.pendingDialogType = "filter-trace";
    this.showInputDialog({
      title: "Filter by Trace ID",
      label: "Enter trace ID (empty to clear):",
      defaultValue: "",
    });
  }

  showFilterByActionTypeDialog(): void {
    const logs = this.monitorView.getFilteredLogs();
    const actions = [...new Set(logs.map((l) => l.action_type).filter(Boolean))];
    const actionList = actions.length > 0 ? actions.join(", ") : "(no actions)";

    this.pendingDialogType = "filter-action";
    this.showInputDialog({
      title: "Filter by Action Type",
      label: `Available actions: ${actionList}\nEnter action type (empty to clear):`,
      defaultValue: "",
    });
  }

  private handleSearchResult(query: string): void {
    this.state.filterText = query;
    this.statusMessage = `Searching for: ${query}`;
  }

  private handleIdentityFilterResult(identity: string): void {
    if (identity) {
      this.monitorView.setFilter({ identityId: identity });
      this.statusMessage = `Filtered by identity: ${identity}`;
    } else {
      this.monitorView.setFilter({ identityId: undefined });
      this.statusMessage = "Filter cleared";
    }
    this.monitorView.refreshLogs().then(() => {
      this.buildTree();
      this.selectFirstLog();
    });
  }

  private handleTimeFilterResult(minutes: string): void {
    if (minutes) {
      const ms = parseInt(minutes, 10) * 60 * 1000;
      const since = new Date(Date.now() - ms).toISOString();
      this.monitorView.setFilter({ since });
      this.statusMessage = `Showing logs from last ${minutes} minutes`;
    } else {
      this.monitorView.setFilter({ since: undefined });
      this.statusMessage = "Time filter cleared";
    }
    this.monitorView.refreshLogs().then(() => {
      this.buildTree();
      this.selectFirstLog();
    });
  }

  private handleTraceFilterResult(traceId: string): void {
    if (traceId) {
      this.monitorView.setFilter({ traceId: traceId });
      this.statusMessage = `Filtered by Trace ID: ${traceId}`;
    } else {
      this.monitorView.setFilter({ traceId: undefined });
      this.statusMessage = "Trace filter cleared";
    }
    this.monitorView.refreshLogs().then(() => {
      this.buildTree();
      this.selectFirstLog();
    });
  }

  private handleActionFilterResult(actionType: string): void {
    if (actionType) {
      this.monitorView.setFilter({ actionType: actionType });
      this.statusMessage = `Filtered by Action: ${actionType}`;
    } else {
      this.monitorView.setFilter({ actionType: undefined });
      this.statusMessage = "Action filter cleared";
    }
    this.monitorView.refreshLogs().then(() => {
      this.buildTree();
      this.selectFirstLog();
    });
  }

  // Navigation

  // Dialog Management

  public override onDialogClosed(dialog: DialogBase): void {
    const result = dialog.getResult();
    if (result.type === DialogStatus.CANCELLED) {
      this.pendingDialogType = null;
      return;
    }

    const value = result.value as string;
    switch (this.pendingDialogType) {
      case TUI_ACTION_SEARCH:
        this.handleSearchResult(value);
        break;
      case "filter-identity":
        this.handleIdentityFilterResult(value);
        break;
      case "filter-time":
        this.handleTimeFilterResult(value);
        break;
      case "filter-trace":
        this.handleTraceFilterResult(value);
        break;
      case "filter-action":
        this.handleActionFilterResult(value);
        break;
    }
    this.pendingDialogType = null;
  }

  // Key Handling

  /**
   * Handle navigation and selection keys
   */
  private handleSelectionKey(key: string): boolean {
    switch (key) {
      case KEYS.ENTER: {
        const selectedId = this.state.selectedId;
        if (selectedId) {
          const selected = this.getSelectedNode();
          if (selected && selected.type !== "log") {
            this.toggleCurrentNode();
          } else {
            this.showLogDetail(selectedId);
          }
        }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Handle toggle action keys
   */
  private handleToggleKey(key: string): boolean {
    switch (key) {
      case KEYS.SPACE:
        this.togglePause();
        return true;
      case KEYS.B:
        this.toggleBookmark();
        return true;
      case KEYS.G:
        this.toggleGrouping();
        return true;
      case KEYS.A:
        this.toggleAutoRefresh();
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle dialog action keys
   */
  private handleDialogKey(key: string): boolean {
    switch (key) {
      case KEYS.S:
        this.showSearchDialog();
        return true;
      case MonitorViewAction.FILTER_IDENTITY:
        this.showFilterByIdentityDialog();
        return true;
      case KEYS.T:
        this.showTimeFilterDialog();
        return true;
      case KEYS.CAP_T:
        this.showFilterByTraceIdDialog();
        return true;
      case KEYS.CAP_A:
        this.showFilterByActionTypeDialog();
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle bulk action keys
   */
  private handleBulkActionKey(key: string): boolean {
    switch (key) {
      case KEYS.CAP_R:
        // Refresh is async, but we can trigger it and return true synchronously
        this.refresh();
        return true;
      case KEYS.E:
        this.exportLogs();
        return true;
      case KEYS.CAP_E:
        this.expandAllNodes();
        return true;
      case KEYS.C:
        this.collapseAllNodes();
        return true;
      default:
        return false;
    }
  }

  public override async handleKey(key: string): Promise<boolean> {
    // 1. Handle dialogs (delegated to base)
    if (await this.handleDialogKeys(key)) return true;

    // 2. Handle detail view
    if (this.logViewExtensions.showDetail) {
      if (key === KEYS.ESCAPE || key === KEYS.Q) {
        this.logViewExtensions.showDetail = false;
      }
      return true;
    }

    // 3. Handle help screen (delegated to base)
    if (this.handleHelpKeys(key)) return true;

    // 4. Handle navigation (delegated to base)
    if (key !== KEYS.E && key !== KEYS.CAP_R) {
      if (this.handleNavigationKeys(key)) {
        return true;
      }
    }

    // 5. Handle action keys using helper methods
    if (this.handleSelectionKey(key)) return true;
    if (this.handleToggleKey(key)) return true;
    if (this.handleDialogKey(key)) return true;
    if (this.handleBulkActionKey(key)) return true;

    return false;
  }

  // Lifecycle

  cleanup(): void {
    this.stopAutoRefresh();
  }

  getFocusableElements(): string[] {
    return ["log-list", TUI_ELEMENT_ACTION_BUTTONS];
  }
}
