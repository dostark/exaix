/**
 * @module StructuredLogViewer
 * @path apps/tui/src/structured_log_viewer.ts
 * @description Advanced TUI component for visualizing structured logs, with support for correlation-based tracing and performance metrics.
 * @architectural-layer TUI
 * @related-files ["packages/core/src/logger/structured_event_output.ts", apps/tui/src/monitor_view.ts]
 */

import { createGroupNode, createNode, getFirstNodeId, type ITreeNode } from "@exaix/tui/helpers/tree_view.ts";
import { type IHelpSection, renderHelpScreen } from "@exaix/tui/helpers/help_renderer.ts";
import { BaseTreeView } from "@exaix/tui/base/base_tree_view.ts";
import type { ITreeViewState } from "@exaix/tui/base/tree_view_state.ts";
import type { DialogBase } from "@exaix/tui/helpers/dialog_base.ts";
import { type IKeyBinding, KeyBindingCategory, KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { KeyBindingsBase } from "@exaix/tui/base/key_bindings_base.ts";
import type { ILogger, ILogService } from "@exaix/core/types";
import type { IStructuredLogEntry, LogQueryOptions } from "@exaix/core/types";
import {
  TUI_ACTION_SEARCH,
  TUI_KEY_LABEL_ENTER,
  TUI_LAYOUT_FULL_WIDTH,
  TUI_LIMIT_LOGS_DEFAULT,
  TUI_LIMIT_LOGS_MAX,
} from "@exaix/tui/helpers/constants.ts";
import { MONITOR_AUTO_REFRESH_INTERVAL_MS } from "@exaix/tui/config.ts";
import { DialogStatus, LogLevel, MessageType } from "@exaix/core";
import { LogGroupingMode, TuiColorName, TuiNodeType } from "@exaix/tui";

// ===== View State =====

/**
 * View-specific extensions for StructuredLogViewer
 */
export interface ILogViewExtensions {
  /** Bookmarked log IDs */
  bookmarkedIds: Set<string>;
  /** Current grouping mode */
  groupBy: LogGroupingMode;
  /** Whether auto-refresh is enabled */
  autoRefresh: boolean;
  /** Log level filter */
  logLevelFilter: LogLevel[];
  /** Whether performance metrics are shown */
  showPerformanceMetrics: boolean;
  /** Correlation mode active */
  correlationMode: boolean;
  /** Active correlation ID for tracing */
  activeCorrelationId: string | null;
  /** Active trace ID for tracing */
  activeTraceId: string | null;
  /** Real-time streaming enabled */
  realTimeEnabled: boolean;
  /** Current log entries */
  logEntries: IStructuredLogEntry[];
  /** Filtered log entries */
  filteredEntries: IStructuredLogEntry[];
  /** Whether detail view is shown */
  showDetail: boolean;
  /** Detail content for expanded log */
  detailContent: string;
}

// ===== Icons and Visual Constants =====

export const STRUCTURED_LOG_ICONS: Record<string, string> = {
  "debug": "🔍",
  "info": "ℹ️",
  "warn": "⚠️",
  "error": "❌",
  "fatal": "💥",
  "trace": "🔗",
  "correlation": "🔗",
  "performance": "⚡",
  "agent": "🤖",
  "operation": "⚙️",
  "request": "📨",
  "response": "📤",
  "default": "📋",
};

export const STRUCTURED_LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: TuiColorName.GRAY,
  [LogLevel.INFO]: TuiColorName.BLUE,
  [LogLevel.WARN]: TuiColorName.YELLOW,
  [LogLevel.ERROR]: TuiColorName.RED,
  [LogLevel.FATAL]: TuiColorName.MAGENTA,
};

// ===== Key Bindings =====

export enum StructuredLogViewerAction {
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
  FILTER_LEVEL = "filter-level",
  CORRELATION_MODE = "correlation-mode",
  TRACE_MODE = "trace-mode",
  PERFORMANCE_TOGGLE = "performance-toggle",
  TOGGLE_GROUPING = "toggle-grouping",
  REFRESH = "refresh",
  AUTO_REFRESH = "auto-refresh",
  COLLAPSE_ALL = "collapse-all",
  EXPAND_ALL = "expand-all",
  HELP = "help",
  QUIT = "quit",
  CANCEL = "cancel",
}

export class StructuredLogViewerKeyBindings extends KeyBindingsBase<StructuredLogViewerAction, KeyBindingCategory> {
  readonly KEY_BINDINGS: readonly IKeyBinding<StructuredLogViewerAction, KeyBindingCategory>[] = [
    {
      key: KEYS.UP,
      action: StructuredLogViewerAction.NAVIGATE_UP,
      description: "Move up",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.DOWN,
      action: StructuredLogViewerAction.NAVIGATE_DOWN,
      description: "Move down",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.HOME,
      action: StructuredLogViewerAction.NAVIGATE_HOME,
      description: "Go to first",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.END,
      action: StructuredLogViewerAction.NAVIGATE_END,
      description: "Go to last",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.LEFT,
      action: StructuredLogViewerAction.COLLAPSE,
      description: "Collapse group",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.RIGHT,
      action: StructuredLogViewerAction.EXPAND,
      description: "Expand group",
      category: KeyBindingCategory.NAVIGATION,
    },
    {
      key: KEYS.ENTER,
      action: StructuredLogViewerAction.VIEW_DETAILS,
      description: "View log details",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.SPACE,
      action: StructuredLogViewerAction.TOGGLE_PAUSE,
      description: "Toggle pause",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.B,
      action: StructuredLogViewerAction.BOOKMARK,
      description: "Bookmark entry",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.E,
      action: StructuredLogViewerAction.EXPORT,
      description: "Export logs",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.S,
      action: StructuredLogViewerAction.SEARCH,
      description: "Search logs",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.F,
      action: StructuredLogViewerAction.FILTER_LEVEL,
      description: "Filter by log level",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.C,
      action: StructuredLogViewerAction.CORRELATION_MODE,
      description: "Toggle correlation mode",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.T,
      action: StructuredLogViewerAction.TRACE_MODE,
      description: "Toggle trace mode",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.P,
      action: StructuredLogViewerAction.PERFORMANCE_TOGGLE,
      description: "Toggle performance metrics",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.G,
      action: StructuredLogViewerAction.TOGGLE_GROUPING,
      description: "Toggle grouping",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.R,
      action: StructuredLogViewerAction.REFRESH,
      description: "Force refresh",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.A,
      action: StructuredLogViewerAction.AUTO_REFRESH,
      description: "Toggle auto-refresh",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.CAP_C,
      action: StructuredLogViewerAction.COLLAPSE_ALL,
      description: "Collapse all",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.CAP_E,
      action: StructuredLogViewerAction.EXPAND_ALL,
      description: "Expand all",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.QUESTION,
      action: StructuredLogViewerAction.HELP,
      description: "Toggle help",
      category: KeyBindingCategory.HELP,
    },
    {
      key: KEYS.Q,
      action: StructuredLogViewerAction.QUIT,
      description: "Close/Back",
      category: KeyBindingCategory.HELP,
    },
    {
      key: KEYS.ESCAPE,
      action: StructuredLogViewerAction.CANCEL,
      description: "Close dialog/view",
      category: KeyBindingCategory.HELP,
    },
  ];
}

export const STRUCTURED_LOG_VIEWER_KEY_BINDINGS = new StructuredLogViewerKeyBindings().KEY_BINDINGS;

// ===== StructuredLogViewer Class =====

/**
 * View/controller for structured log monitoring with real-time streaming.
 */
export class StructuredLogViewer extends BaseTreeView<IStructuredLogEntry> {
  protected logViewExtensions: ILogViewExtensions;
  private logService: ILogService;
  private structuredLogger: ILogger;
  private unsubscribeRealTime?: () => void;
  private refreshInterval?: ReturnType<typeof setInterval>;
  private pendingDialogType: "search" | "filter-level" | "export" | null = null;

  constructor(
    logService: ILogService,
    structuredLogger: ILogger,
    options: { testMode?: boolean } = {},
  ) {
    super(options.testMode ? false : true);

    this.logService = logService;
    this.structuredLogger = structuredLogger;
    this.logViewExtensions = this.createInitialExtensions(options.testMode);

    // Setup real-time streaming if enabled
    if (this.logViewExtensions.realTimeEnabled) {
      this.setupRealTimeStreaming();
    }

    // Setup auto-refresh if enabled
    if (this.logViewExtensions.autoRefresh) {
      this.setupAutoRefresh();
    }

    this.initialize();
  }

  async initialize(): Promise<void> {
    await this.refreshLogs();
    const firstId = getFirstNodeId(this.state.tree);
    if (firstId) {
      this.state.selectedId = firstId;
    }
  }

  private createInitialExtensions(testMode = false): ILogViewExtensions {
    return {
      bookmarkedIds: new Set(),
      groupBy: LogGroupingMode.CORRELATION,
      autoRefresh: testMode ? false : true,
      logLevelFilter: [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL],
      showPerformanceMetrics: true,
      correlationMode: false,
      activeCorrelationId: null,
      activeTraceId: null,
      realTimeEnabled: testMode ? false : true,
      logEntries: [],
      filteredEntries: [],
      showDetail: false,
      detailContent: "",
    };
  }

  private setupRealTimeStreaming(): void {
    this.unsubscribeRealTime = this.logService.subscribeToLogs((entry: IStructuredLogEntry) => {
      this.handleNewLogEntry(entry);
    });
  }

  private setupAutoRefresh(): void {
    this.refreshInterval = setInterval(() => {
      if (this.logViewExtensions.autoRefresh) {
        this.refreshLogs();
      }
    }, MONITOR_AUTO_REFRESH_INTERVAL_MS); // Use centralized refresh interval
  }

  private handleNewLogEntry(entry: IStructuredLogEntry): void {
    // Add to entries and update filtered view
    this.logViewExtensions.logEntries.unshift(entry); // Newest first
    this.applyFilters();
    this.buildTree();

    // Limit entries to prevent memory issues
    if (this.logViewExtensions.logEntries.length > TUI_LIMIT_LOGS_MAX) {
      this.logViewExtensions.logEntries = this.logViewExtensions.logEntries.slice(0, TUI_LIMIT_LOGS_MAX);
    }
  }

  /** Refresh logs from the service. */
  async refreshLogs(): Promise<void> {
    try {
      this.setLoading(true, "Refreshing logs...");
      const options: LogQueryOptions = {
        level: this.logViewExtensions.logLevelFilter,
        limit: TUI_LIMIT_LOGS_DEFAULT,
        includePerformance: this.logViewExtensions.showPerformanceMetrics,
      };

      if (this.logViewExtensions.correlationMode && this.logViewExtensions.activeCorrelationId) {
        options.correlationId = this.logViewExtensions.activeCorrelationId;
      }

      if (this.logViewExtensions.activeTraceId) {
        options.traceId = this.logViewExtensions.activeTraceId;
      }

      this.logViewExtensions.logEntries = await this.logService.getStructuredLogs(options);
      this.applyFilters();
      this.buildTree();
    } catch (error) {
      this.setStatus(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`, MessageType.ERROR);
    } finally {
      this.setLoading(false);
    }
  }

  private applyFilters(): void {
    let filtered = [...this.logViewExtensions.logEntries];

    // Apply search filter
    if (this.state.filterText) {
      const query = this.state.filterText.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.message.toLowerCase().includes(query) ||
        JSON.stringify(entry.context).toLowerCase().includes(query) ||
        JSON.stringify(entry.metadata).toLowerCase().includes(query)
      );
    }

    // Apply log level filter
    filtered = filtered.filter((entry) => this.logViewExtensions.logLevelFilter.includes(entry.level));

    this.logViewExtensions.filteredEntries = filtered;
  }

  protected override buildTree(): void {
    const nodes: ITreeNode<IStructuredLogEntry>[] = [];

    if (this.logViewExtensions.groupBy === LogGroupingMode.NONE) {
      // Flat list
      for (const entry of this.logViewExtensions.filteredEntries) {
        const node = createNode<IStructuredLogEntry>(
          entry.timestamp,
          this.formatLogEntry(entry),
          "log",
          { expanded: false, data: entry },
        );
        nodes.push(node);
      }
    } else {
      // Grouped view
      const groups = this.groupEntries(this.logViewExtensions.filteredEntries, this.logViewExtensions.groupBy);

      for (const [groupKey, entries] of Object.entries(groups)) {
        const childNodes: ITreeNode<IStructuredLogEntry>[] = [];
        for (const entry of entries) {
          const node = createNode<IStructuredLogEntry>(
            entry.timestamp,
            this.formatLogEntry(entry),
            "log",
            { expanded: false, data: entry },
          );
          childNodes.push(node);
        }

        const groupNode = createGroupNode<IStructuredLogEntry>(
          groupKey,
          `${this.getGroupIcon(this.logViewExtensions.groupBy)} ${groupKey} (${entries.length})`,
          TuiNodeType.GROUP,
          childNodes,
          { expanded: true },
        );

        nodes.push(groupNode);
      }
    }

    this.state.tree = nodes;
  }

  private groupEntries(entries: IStructuredLogEntry[], groupBy: string): Record<string, IStructuredLogEntry[]> {
    const groups: Record<string, IStructuredLogEntry[]> = {};

    for (const entry of entries) {
      let key: string;

      switch (groupBy) {
        case LogGroupingMode.CORRELATION:
          key = entry.context.correlation_id || "no-correlation";
          break;
        case LogGroupingMode.TRACE:
          key = entry.context.trace_id || "no-trace";
          break;
        case LogGroupingMode.IDENTITY:
          key = entry.context.identity_id || "no-agent";
          break;
        case LogGroupingMode.LEVEL:
          key = entry.level;
          break;
        case LogGroupingMode.TIME: {
          const date = new Date(entry.timestamp);
          key = date.toISOString().split("T")[0]; // YYYY-MM-DD
          break;
        }
        default:
          key = "all";
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(entry);
    }

    return groups;
  }

  private getGroupIcon(groupBy: string): string {
    switch (groupBy) {
      case LogGroupingMode.CORRELATION:
        return STRUCTURED_LOG_ICONS.correlation;
      case LogGroupingMode.TRACE:
        return STRUCTURED_LOG_ICONS.trace;
      case LogGroupingMode.IDENTITY:
        return STRUCTURED_LOG_ICONS.agent;
      case LogGroupingMode.LEVEL:
        return STRUCTURED_LOG_ICONS[LogLevel.DEBUG] || "📊";
      case LogGroupingMode.TIME:
        return "🕐";
      default:
        return "📁";
    }
  }

  private formatLogEntry(entry: IStructuredLogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const level = entry.level.toUpperCase().padEnd(5);
    const icon = STRUCTURED_LOG_ICONS[entry.level] || STRUCTURED_LOG_ICONS.default;

    let contextStr = "";
    if (entry.context.trace_id) {
      contextStr += ` trace=${entry.context.trace_id.slice(0, 8)}`;
    }
    if (entry.context.identity_id) {
      contextStr += ` agent=${entry.context.identity_id}`;
    }
    if (entry.context.operation) {
      contextStr += ` op=${entry.context.operation}`;
    }

    let perfStr = "";
    if (this.logViewExtensions.showPerformanceMetrics && entry.performance) {
      if (entry.performance.duration_ms) {
        perfStr += ` ${entry.performance.duration_ms}ms`;
      }
      if (entry.performance.memory_mb) {
        perfStr += ` ${entry.performance.memory_mb}MB`;
      }
    }

    return `${timestamp} ${icon} ${level} ${entry.message}${contextStr}${perfStr}`;
  }

  override getViewName(): string {
    return "Structured Log Viewer";
  }

  override getKeyBindings(): IKeyBinding<string>[] {
    return STRUCTURED_LOG_VIEWER_KEY_BINDINGS.map((b) => ({ ...b, action: b.action as string }));
  }

  /** Get all current logs. */
  async getLogs(): Promise<IStructuredLogEntry[]> {
    await this.refreshLogs();
    return [...this.logViewExtensions.logEntries];
  }

  /** Set the filter for logs. */
  setLogLevelFilter(levels: LogLevel[]): void {
    this.logViewExtensions.logLevelFilter = [...levels];
    this.applyFilters();
    this.buildTree();
  }

  /** Toggle correlation mode for a specific correlation ID. */
  async setCorrelationMode(correlationId: string | null): Promise<void> {
    this.logViewExtensions.correlationMode = correlationId !== null;
    this.logViewExtensions.activeCorrelationId = correlationId;

    if (correlationId) {
      this.logViewExtensions.logEntries = await this.logService.getLogsByCorrelationId(correlationId);
    } else {
      await this.refreshLogs();
    }

    this.applyFilters();
    this.buildTree();
  }

  /** Toggle trace mode for a specific trace ID. */
  async setTraceMode(traceId: string | null): Promise<void> {
    this.logViewExtensions.activeTraceId = traceId;

    if (traceId) {
      this.logViewExtensions.logEntries = await this.logService.getLogsByTraceId(traceId);
    } else {
      await this.refreshLogs();
    }

    this.applyFilters();
    this.buildTree();
  }

  /** Toggle performance metrics display. */
  togglePerformanceMetrics(): void {
    this.logViewExtensions.showPerformanceMetrics = !this.logViewExtensions.showPerformanceMetrics;
    this.buildTree();
  }

  /** Toggle real-time streaming. */
  toggleRealTime(): void {
    this.logViewExtensions.realTimeEnabled = !this.logViewExtensions.realTimeEnabled;

    if (this.logViewExtensions.realTimeEnabled) {
      this.setupRealTimeStreaming();
    } else {
      if (this.unsubscribeRealTime) {
        this.unsubscribeRealTime();
        this.unsubscribeRealTime = undefined;
      }
    }
  }

  /** Toggle auto-refresh. */
  toggleAutoRefresh(): void {
    this.logViewExtensions.autoRefresh = !this.logViewExtensions.autoRefresh;

    if (this.logViewExtensions.autoRefresh) {
      this.setupAutoRefresh();
    } else {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = undefined;
      }
    }
  }

  /** Set search query. */
  setSearchQuery(query: string): void {
    this.state.filterText = query;
    this.applyFilters();
    this.buildTree();
  }

  /** Toggle grouping mode. */
  toggleGrouping(): void {
    const modes = [
      LogGroupingMode.CORRELATION,
      LogGroupingMode.TRACE,
      LogGroupingMode.IDENTITY,
      LogGroupingMode.LEVEL,
      LogGroupingMode.TIME,
      LogGroupingMode.NONE,
    ];
    const currentIndex = modes.indexOf(this.logViewExtensions.groupBy);
    this.logViewExtensions.groupBy = modes[(currentIndex + 1) % modes.length];
    this.buildTree();
  }

  /** Bookmark/unbookmark a log entry. */
  toggleBookmark(logId: string): void {
    if (this.logViewExtensions.bookmarkedIds.has(logId)) {
      this.logViewExtensions.bookmarkedIds.delete(logId);
    } else {
      this.logViewExtensions.bookmarkedIds.add(logId);
    }
  }

  /** Export logs to file. */
  async exportLogs(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `structured-logs-${timestamp}.jsonl`;

      await this.logService.exportLogs(filename, this.logViewExtensions.filteredEntries);
      this.setStatus(`Logs exported to ${filename}`, MessageType.INFO);
    } catch (error) {
      this.setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`, MessageType.ERROR);
    }
  }

  /** Get detailed view content for a log entry. */
  getLogDetail(logId: string): string {
    const entry = this.logViewExtensions.logEntries.find((e: IStructuredLogEntry) => e.timestamp === logId);
    if (!entry) return "Log entry not found";

    let detail = `Timestamp: ${entry.timestamp}\n`;
    detail += `Level: ${entry.level.toUpperCase()}\n`;
    detail += `Message: ${entry.message}\n\n`;

    detail += `Context:\n`;
    for (const [key, value] of Object.entries(entry.context)) {
      if (value) {
        detail += `  ${key}: ${value}\n`;
      }
    }

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      detail += `\nMetadata:\n`;
      detail += JSON.stringify(entry.metadata, null, 2);
    }

    if (entry.performance) {
      detail += `\nPerformance:\n`;
      detail += JSON.stringify(entry.performance, null, 2);
    }

    if (entry.error) {
      detail += `\nError:\n`;
      detail += `  Name: ${entry.error.name}\n`;
      detail += `  Message: ${entry.error.message}\n`;
      if (entry.error.stack) {
        detail += `  Stack:\n${entry.error.stack}\n`;
      }
    }

    return detail;
  }

  /** Clean up resources. */
  destroy(): void {
    if (this.unsubscribeRealTime) {
      this.unsubscribeRealTime();
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  // ===== TUI Session Base Implementation =====

  // ===== Dialog Handlers =====

  protected override onDialogClosed(dialog: DialogBase): void {
    const result = dialog.getResult();
    if (result.type !== DialogStatus.CONFIRMED) {
      this.pendingDialogType = null;
      return;
    }

    const value = result.value as string;
    switch (this.pendingDialogType) {
      case TUI_ACTION_SEARCH:
        this.setSearchQuery(value);
        break;
      case "filter-level":
        // Handle filter level if implemented
        break;
      case "export":
        // Handle export if implemented via dialog
        break;
    }
    this.pendingDialogType = null;
  }

  // ===== Input Handling =====

  /**
   * Handle detail view key actions
   */
  private handleDetailViewKey(key: string): boolean {
    if (!this.logViewExtensions.showDetail) return false;

    if (key === KEYS.ESCAPE || key === KEYS.Q) {
      this.logViewExtensions.showDetail = false;
      this.logViewExtensions.detailContent = "";
      return true;
    }

    return false;
  }

  /**
   * Handle selection and navigation key actions
   */
  private handleSelectionKey(key: string): boolean {
    if (key !== KEYS.ENTER) return false;

    if (this.state.selectedId) {
      if (this.isGroupNode(this.state.selectedId)) {
        this.toggleCurrentNode();
      } else {
        this.logViewExtensions.showDetail = true;
        this.logViewExtensions.detailContent = this.getLogDetail(this.state.selectedId);
      }
    }
    return true;
  }

  /**
   * Handle toggle key actions
   */
  private handleToggleKey(key: string): boolean {
    switch (key) {
      case KEYS.SPACE:
        this.toggleRealTime();
        return true;
      case KEYS.P:
        this.togglePerformanceMetrics();
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
   * Handle bookmark key actions
   */
  private handleBookmarkKey(key: string): boolean {
    if (key !== KEYS.B) return false;

    if (this.state.selectedId && !this.isGroupNode(this.state.selectedId)) {
      this.toggleBookmark(this.state.selectedId);
    }
    return true;
  }

  /**
   * Handle dialog key actions
   */
  private handleDialogKey(key: string): boolean {
    switch (key) {
      case KEYS.S:
        this.showInputDialog({
          title: "Search Logs",
          label: "Enter search query:",
          defaultValue: this.state.filterText,
        });
        this.pendingDialogType = TUI_ACTION_SEARCH;
        return true;
      case KEYS.F:
        // Toggle log level filter dialog would go here
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle bulk action key actions
   */
  private handleBulkActionKey(key: string): boolean {
    switch (key) {
      case KEYS.CAP_C:
        this.collapseAllNodes();
        return true;
      case KEYS.CAP_E:
        this.expandAllNodes();
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle asynchronous key actions
   */
  private async handleAsyncKey(key: string): Promise<boolean> {
    switch (key) {
      case KEYS.E:
        await this.exportLogs();
        return true;
      case KEYS.C:
        await this.handleCorrelationMode();
        return true;
      case KEYS.T:
        await this.handleTraceMode();
        return true;
      case KEYS.CAP_R:
        await this.refreshLogs();
        return true;
      default:
        return false;
    }
  }

  public override async handleKey(key: string): Promise<boolean> {
    // 1. Handle dialogs (delegated to base)
    if (await this.handleDialogKeys(key)) return true;

    // 2. Handle help overlay (delegated to base)
    if (this.handleHelpKeys(key)) return true;

    // 3. Handle detail view
    if (this.handleDetailViewKey(key)) return true;

    // 4. Main actions - try each handler in order
    const handled = this.handleSelectionKey(key) ||
      this.handleToggleKey(key) ||
      this.handleBookmarkKey(key) ||
      this.handleDialogKey(key) ||
      this.handleBulkActionKey(key);

    if (handled) return true;

    // 5. Handle async actions
    if (await this.handleAsyncKey(key)) return true;

    // 6. Handle navigation (delegated to base)
    // Keys handled by handleAsyncKey are already filtered out
    return this.handleNavigationKeys(key);
  }

  private isGroupNode(id: string): boolean {
    return id.includes("-") && (
      id.startsWith("correlation-") ||
      id.startsWith("trace-") ||
      id.startsWith("agent-") ||
      id.startsWith("level-") ||
      id.startsWith("time-") ||
      id.startsWith("group-")
    );
  }

  private async handleCorrelationMode(): Promise<void> {
    if (this.logViewExtensions.correlationMode) {
      await this.setCorrelationMode(null);
    } else {
      const selectedNode = this.getSelectedNode();
      if (selectedNode && selectedNode.data) {
        const entry = selectedNode.data as IStructuredLogEntry;
        if (entry.context.correlation_id) {
          await this.setCorrelationMode(entry.context.correlation_id);
        }
      }
    }
  }

  private async handleTraceMode(): Promise<void> {
    if (this.logViewExtensions.activeTraceId) {
      await this.setTraceMode(null);
    } else {
      const selectedNode = this.getSelectedNode();
      if (selectedNode && selectedNode.data) {
        const entry = selectedNode.data as IStructuredLogEntry;
        if (entry.context.trace_id) {
          await this.setTraceMode(entry.context.trace_id);
        }
      }
    }
  }

  render(width: number, height: number): Promise<string[]> {
    const lines: string[] = [];

    // Help overlay
    if (this.state.showHelp) {
      return Promise.resolve(this.renderHelp());
    }

    // Detail view
    if (this.logViewExtensions.showDetail) {
      const detailLines = this.logViewExtensions.detailContent.split("\n");
      const startY = Math.max(0, Math.floor((height - detailLines.length) / 2));
      const startX = Math.max(0, Math.floor((width - TUI_LAYOUT_FULL_WIDTH) / 2));

      for (let i = 0; i < height; i++) {
        if (i >= startY && i < startY + detailLines.length) {
          const line = detailLines[i - startY];
          const paddedLine = line.padEnd(TUI_LAYOUT_FULL_WIDTH);
          lines.push(" ".repeat(startX) + paddedLine);
        } else {
          lines.push("");
        }
      }
      return Promise.resolve(lines);
    }

    // Main log view
    const header = this.renderHeader();
    lines.push(header);

    const treeLines = this.renderTreeView();
    lines.push(...treeLines);

    // Status bar
    const statusBar = this.renderStatusBar();
    lines.push(statusBar.padEnd(width));

    return Promise.resolve(lines);
  }

  renderHelp(): string[] {
    return renderHelpScreen({
      title: "Structured Log Viewer Help",
      sections: this.getHelpSections(),
    });
  }

  private renderHeader(): string {
    let header = "Structured Log Viewer";

    if (this.logViewExtensions.correlationMode && this.logViewExtensions.activeCorrelationId) {
      header += ` | Correlation: ${this.logViewExtensions.activeCorrelationId.slice(0, 8)}`;
    }

    if (this.logViewExtensions.activeTraceId) {
      header += ` | Trace: ${this.logViewExtensions.activeTraceId.slice(0, 8)}`;
    }

    if (this.state.filterText) {
      header += ` | Search: "${this.state.filterText}"`;
    }

    header += ` | Group: ${this.logViewExtensions.groupBy}`;
    header += ` | Levels: ${this.logViewExtensions.logLevelFilter.join(",")}`;

    return header;
  }

  override renderStatusBar(): string {
    const statusParts: string[] = [];

    statusParts.push(`${this.logViewExtensions.filteredEntries.length} logs`);

    if (this.logViewExtensions.realTimeEnabled) {
      statusParts.push("LIVE");
    }

    if (this.logViewExtensions.autoRefresh) {
      statusParts.push("AUTO");
    }

    if (this.logViewExtensions.showPerformanceMetrics) {
      statusParts.push("PERF");
    }

    if (this.logViewExtensions.bookmarkedIds.size > 0) {
      statusParts.push(`${this.logViewExtensions.bookmarkedIds.size} bookmarks`);
    }

    return statusParts.join(" | ");
  }

  // ===== Testing Helpers =====

  /** Exposed for testing to access view-specific state */
  getExtensions(): ILogViewExtensions {
    return this.logViewExtensions;
  }

  /** Exposed for testing to get selected ID */
  getSelectedId(): string | null {
    return this.state.selectedId;
  }

  /** Exposed for testing to access tree state */
  getTreeState(): ITreeViewState<IStructuredLogEntry> {
    return this.state;
  }

  /** Exposed for testing to force tree rebuild */
  rebuildTree(): void {
    this.buildTree();
  }

  /** Exposed for testing to set selected ID directly */
  setSelectedId(id: string | null): void {
    this.state.selectedId = id;
  }

  /** Exposed for testing to format log entry */
  formatLogEntryForTest(entry: IStructuredLogEntry): string {
    return this.formatLogEntry(entry);
  }

  /** Exposed for testing to check refresh interval */
  getRefreshInterval(): ReturnType<typeof setInterval> | undefined {
    return this.refreshInterval;
  }

  private getHelpSections(): IHelpSection[] {
    return [
      {
        title: "Navigation",
        items: [
          { key: "↑/↓", description: "Navigate logs" },
          { key: "Home/End", description: "First/Last log" },
          { key: "←/→", description: "Collapse/Expand groups" },
          { key: TUI_KEY_LABEL_ENTER, description: "View log details" },
        ],
      },
      {
        title: "Actions",
        items: [
          { key: "b", description: "Bookmark log" },
          { key: "e", description: "Export logs" },
          { key: "s", description: "Search logs" },
          { key: "f", description: "Filter by level" },
          { key: "c", description: "Toggle correlation mode" },
          { key: "t", description: "Toggle trace mode" },
        ],
      },
      {
        title: "View",
        items: [
          { key: "p", description: "Toggle performance metrics" },
          { key: "g", description: "Change grouping" },
          { key: "R", description: "Force refresh" },
          { key: "a", description: "Toggle auto-refresh" },
          { key: "C", description: "Collapse all" },
          { key: "E", description: "Expand all" },
        ],
      },
      {
        title: "General",
        items: [
          { key: "?", description: "Toggle help" },
          { key: "q/Esc", description: "Close/Back" },
        ],
      },
    ];
  }
}
