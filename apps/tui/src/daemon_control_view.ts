/**
 * @module DaemonControlView
 * @path apps/tui/src/daemon_control_view.ts
 * @description Interactive TUI view for managing the Exaix daemon, featuring status visualization, log tailing, and configuration viewing.
 * @architectural-layer TUI
 * @related-files ["@exaix/core/types", "apps/exactl/src/commands/daemon_commands.ts"]
 */

import { TuiSessionBase } from "@exaix/tui/base/tui_session_base.ts";
import { createSpinnerState, type SpinnerState, startSpinner, stopSpinner } from "@exaix/tui/helpers/spinner.ts";
import { type IHelpSection, renderHelpScreen } from "@exaix/tui/helpers/help_renderer.ts";
import { ConfirmDialog, type InputDialog } from "@exaix/tui/helpers/dialog_base.ts";
import { KeyBindingsBase } from "@exaix/tui/base/key_bindings_base.ts";
import { type IKeyBinding, KeyBindingCategory, KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { DaemonAction, DaemonStatus, DialogStatus, GeneralStatus, MessageType, SystemCommand } from "@exaix/core";
import { TUI_DAEMON_STATUS_ICONS, TUI_LABEL_CANCEL, TUI_LAYOUT_MEDIUM_WIDTH } from "@exaix/tui/helpers/constants.ts";
import { ANSI } from "@exaix/tui/helpers/colors.ts";
import { TUI_SECTION } from "@exaix/tui/helpers/decorations.ts";
import { MONITOR_AUTO_REFRESH_INTERVAL_MS } from "@exaix/tui/config.ts";
import type { IDaemonService } from "@exaix/core/types";

// ===== View State =====

/**
 * State interface for Daemon Control View
 */
export interface IDaemonViewState {
  /** Current daemon status */
  status: DaemonStatus;
  /** Whether help is visible */
  showHelp: boolean;
  /** Whether logs view is shown */
  showLogs: boolean;
  /** Whether config view is shown */
  showConfig: boolean;
  /** Log content */
  logContent: string[];
  /** Error content */
  errorContent: string[];
  /** Active dialog */
  activeDialog: ConfirmDialog | InputDialog | null;
  /** Last status check time */
  lastStatusCheck: Date | null;
  /** Whether auto-refresh is enabled */
  autoRefresh: boolean;
  /** Auto-refresh interval in ms */
  autoRefreshInterval: number;
}

// ===== Constants =====

/** CLI command constants */
const CLI_CMD_START = "start";
const CLI_CMD_STOP = "stop";
const CLI_CMD_STATUS = "status";
const CLI_CMD_DAEMON = "daemon";

/** UI display constants */
const UI_CLOSE_LOGS = "[ESC] Close logs";
const UI_CLOSE_CONFIG = "[ESC] Close config";
const UI_STATUS_PANEL_KEYS = "  [s] Start  [k] Stop  [r] Restart  [l] Logs  [R] Refresh";
const UI_CONFIG_FILE = "exa.config.toml";
const UI_CONFIG_COMING_SOON = "(Configuration viewer coming soon)";

/** Help text constants */
const HELP_START_DESC = "Start daemon";
const HELP_STOP_DESC = "Stop daemon (with confirm)";
const HELP_RESTART_DESC = "Restart daemon (with confirm)";
const HELP_LOGS_DESC = "View logs";
const HELP_CONFIG_DESC = "View config";
const HELP_REFRESH_DESC = "Refresh status";
const HELP_AUTO_REFRESH_DESC = "Toggle auto-refresh";
const HELP_HELP_DESC = "Toggle this help";
const HELP_QUIT_DESC = "Close/Back";

// ===== Icons and Visual Constants =====

export const DAEMON_STATUS_ICONS: Record<string, string> = {
  [DaemonStatus.RUNNING]: TUI_DAEMON_STATUS_ICONS.running,
  [DaemonStatus.STOPPED]: TUI_DAEMON_STATUS_ICONS.stopped,
  [DaemonStatus.ERROR]: TUI_DAEMON_STATUS_ICONS.error,
  [DaemonStatus.UNKNOWN]: TUI_DAEMON_STATUS_ICONS.unknown,
};

export const DAEMON_STATUS_COLORS: Record<string, string> = {
  [DaemonStatus.RUNNING]: ANSI.green,
  [DaemonStatus.STOPPED]: ANSI.red,
  [DaemonStatus.ERROR]: ANSI.yellow,
  [DaemonStatus.UNKNOWN]: ANSI.brightBlack,
};

export const LOG_LEVEL_COLORS: Record<string, string> = {
  info: ANSI.white,
  warn: ANSI.yellow,
  error: ANSI.red,
};

// ===== Key Bindings =====

// ===== Daemon Key Action Types =====
export enum DaemonKeyAction {
  START = "start",
  STOP = "stop",
  RESTART = "restart",
  VIEW_LOGS = "view-logs",
  VIEW_CONFIG = "view-config",
  REFRESH = "refresh",
  AUTO_REFRESH = "auto-refresh",
  HELP = "help",
  QUIT = "quit",
  CANCEL = "cancel",
}
// ===== Key Binding Categories =====

export class DaemonKeyBindings extends KeyBindingsBase<DaemonKeyAction, KeyBindingCategory> {
  readonly KEY_BINDINGS: readonly IKeyBinding<DaemonKeyAction, KeyBindingCategory>[] = [
    {
      key: KEYS.S,
      action: DaemonKeyAction.START,
      description: "Start daemon",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.K,
      action: DaemonKeyAction.STOP,
      description: "Stop daemon (with confirm)",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.R,
      action: DaemonKeyAction.RESTART,
      description: "Restart daemon (with confirm)",
      category: KeyBindingCategory.ACTIONS,
    },
    {
      key: KEYS.L,
      action: DaemonKeyAction.VIEW_LOGS,
      description: "View logs",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.C,
      action: DaemonKeyAction.VIEW_CONFIG,
      description: "View config",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.CAP_R,
      action: DaemonKeyAction.REFRESH,
      description: "Refresh status",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.A,
      action: DaemonKeyAction.AUTO_REFRESH,
      description: "Toggle auto-refresh",
      category: KeyBindingCategory.VIEW,
    },
    {
      key: KEYS.QUESTION,
      action: DaemonKeyAction.HELP,
      description: "Toggle help",
      category: KeyBindingCategory.HELP,
    },
    { key: KEYS.Q, action: DaemonKeyAction.QUIT, description: "Close/Back", category: KeyBindingCategory.HELP },
    {
      key: KEYS.ESCAPE,
      action: DaemonKeyAction.CANCEL,
      description: "Close dialog/view",
      category: KeyBindingCategory.HELP,
    },
  ];
}

export const DAEMON_KEY_BINDINGS = new DaemonKeyBindings().KEY_BINDINGS;

// ===== CLI Daemon Service Implementation =====

/**
 * CLI-backed implementation of DaemonService.
 */
export class CLIDaemonService implements IDaemonService {
  #cliScript = new URL("../../apps/exactl/src/exactl.ts", import.meta.url).pathname;

  async start(): Promise<void> {
    await this.#runDaemonCmd([CLI_CMD_START]);
  }
  async stop(): Promise<void> {
    await this.#runDaemonCmd([CLI_CMD_STOP]);
  }
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
  async getStatus(): Promise<DaemonStatus> {
    const cmd = new Deno.Command(SystemCommand.DENO, {
      args: ["run", "--allow-all", this.#cliScript, CLI_CMD_DAEMON, CLI_CMD_STATUS],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await cmd.output();
    const out = new TextDecoder().decode(stdout).trim().toLowerCase();
    if (out.includes("running")) return DaemonStatus.RUNNING;
    if (out.includes("stopped")) return DaemonStatus.STOPPED;
    return DaemonStatus.UNKNOWN;
  }
  getLogs(): Promise<string[]> {
    // TODO: Implement real log fetching from CLI or file
    return Promise.resolve(["Daemon started", "No errors detected"]);
  }
  getErrors(): Promise<string[]> {
    // TODO: Implement real error fetching from CLI or file
    return Promise.resolve([]);
  }
  async #runDaemonCmd(args: string[]): Promise<void> {
    const cmd = new Deno.Command(SystemCommand.DENO, {
      args: ["run", "--allow-all", this.#cliScript, "daemon", ...args],
      stdout: "null",
      stderr: "null",
    });
    await cmd.output();
  }
}

// ===== Daemon Control View Class =====

/**
 * View/controller for daemon control. Delegates to injected DaemonService.
 */
export class DaemonControlView {
  constructor(public readonly service: IDaemonService) {}

  /** Get daemon status. */
  getStatus(): Promise<string> {
    return this.service.getStatus();
  }
  /** Get daemon logs. */
  getLogs(): Promise<string[]> {
    return this.service.getLogs();
  }
  /** Get daemon errors. */
  getErrors(): Promise<string[]> {
    return this.service.getErrors();
  }
  /** Start the daemon. */
  start(): Promise<void> {
    return this.service.start();
  }
  /** Stop the daemon. */
  stop(): Promise<void> {
    return this.service.stop();
  }
  /** Restart the daemon. */
  restart(): Promise<void> {
    return this.service.restart();
  }

  /**
   * Create TUI session for interactive mode
   */
  createTuiSession(useColors = true): DaemonControlTuiSession {
    return new DaemonControlTuiSession(this, useColors);
  }
}

// ===== Minimal Mock for Tests =====

/**
 * Minimal DaemonService mock for TUI session tests
 */
export class MinimalDaemonServiceMock implements IDaemonService {
  private status = DaemonStatus.STOPPED;
  private logs: string[] = [];
  private errors: string[] = [];

  start(): Promise<void> {
    this.status = DaemonStatus.RUNNING;
    this.logs.push(`[${new Date().toISOString()}] Daemon started`);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.status = DaemonStatus.STOPPED;
    this.logs.push(`[${new Date().toISOString()}] Daemon stopped`);
    return Promise.resolve();
  }

  restart(): Promise<void> {
    this.logs.push(`[${new Date().toISOString()}] Daemon restarting...`);
    return Promise.resolve();
  }

  getStatus(): Promise<DaemonStatus> {
    return Promise.resolve(this.status);
  }

  getLogs(): Promise<string[]> {
    return Promise.resolve([...this.logs]);
  }

  getErrors(): Promise<string[]> {
    return Promise.resolve([...this.errors]);
  }

  setStatus(status: DaemonStatus): void {
    this.status = status;
  }

  setLogs(logs: string[]): void {
    this.logs = logs;
  }

  setErrors(errors: string[]): void {
    this.errors = errors;
  }
}

// ===== TUI Session Class =====

/**
 * Interactive TUI session for Daemon Control View
 */
export class DaemonControlTuiSession extends TuiSessionBase {
  private readonly daemonView: DaemonControlView;
  private state: IDaemonViewState;
  private localSpinnerState: SpinnerState;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(daemonView: DaemonControlView, useColors = true) {
    super(useColors);
    this.daemonView = daemonView;
    this.localSpinnerState = createSpinnerState();
    this.state = {
      status: DaemonStatus.UNKNOWN,
      showHelp: false,
      showLogs: false,
      showConfig: false,
      logContent: [],
      errorContent: [],
      activeDialog: null,
      lastStatusCheck: null,
      autoRefresh: false,
      autoRefreshInterval: MONITOR_AUTO_REFRESH_INTERVAL_MS,
    };
  }

  // ===== Initialization =====

  /**
   * Initialize the session by fetching daemon status
   */
  async initialize(): Promise<void> {
    this.localSpinnerState = startSpinner(this.localSpinnerState, "Checking daemon status...");
    try {
      await this.refreshStatus();
    } finally {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  // ===== State Accessors =====

  override getViewName(): string {
    return "Daemon Control";
  }

  getDaemonStatus(): DaemonStatus {
    return this.state.status;
  }

  override isHelpVisible(): boolean {
    return this.state.showHelp;
  }

  isLogsVisible(): boolean {
    return this.state.showLogs;
  }

  isConfigVisible(): boolean {
    return this.state.showConfig;
  }

  getLogContent(): string[] {
    return this.state.logContent;
  }

  getErrorContent(): string[] {
    return this.state.errorContent;
  }

  hasActiveDialog(): boolean {
    return this.state.activeDialog !== null;
  }

  getActiveDialog(): ConfirmDialog | InputDialog | null {
    return this.state.activeDialog;
  }

  isAutoRefreshEnabled(): boolean {
    return this.state.autoRefresh;
  }

  isLoading(): boolean {
    return this.localSpinnerState.active;
  }

  getLoadingMessage(): string {
    return this.localSpinnerState.message;
  }

  getLastStatusCheck(): Date | null {
    return this.state.lastStatusCheck;
  }

  override getKeyBindings(): IKeyBinding<DaemonKeyAction, KeyBindingCategory>[] {
    return [...DAEMON_KEY_BINDINGS];
  }

  // ===== Status Operations =====

  async refreshStatus(): Promise<void> {
    this.localSpinnerState = startSpinner(this.localSpinnerState, "Refreshing...");
    try {
      const rawStatus = await this.daemonView.getStatus();
      this.state.status = this.parseStatus(rawStatus);
      this.state.lastStatusCheck = new Date();

      // Also refresh logs and errors
      this.state.logContent = await this.daemonView.getLogs();
      this.state.errorContent = await this.daemonView.getErrors();

      this.setStatus("Status refreshed", MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Refresh failed: ${msg}`, MessageType.ERROR);
      this.state.status = DaemonStatus.ERROR;
    } finally {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  private parseStatus(rawStatus: string): DaemonStatus {
    // ...existing code...
    // Normalize input for robust comparison
    let normalized = "";
    if (typeof rawStatus === "string") {
      normalized = rawStatus.trim().toLowerCase();
    } else if (typeof rawStatus === "number" || typeof rawStatus === "boolean") {
      normalized = String(rawStatus).trim().toLowerCase();
    } else if (
      rawStatus &&
      typeof rawStatus === "object" &&
      typeof (rawStatus as { toString?: (() => string) | undefined }).toString === "function"
    ) {
      normalized = (rawStatus as { toString: () => string }).toString().trim().toLowerCase();
    }
    const runningVariants = ["running", "started", "active", "on", "up"];
    const stoppedVariants = ["stopped", "stopping", "inactive", "off", "down"];
    if (runningVariants.includes(normalized)) {
      return DaemonStatus.RUNNING;
    }
    if (stoppedVariants.includes(normalized)) {
      return DaemonStatus.STOPPED;
    }
    // Error variants
    if ([GeneralStatus.ERROR, GeneralStatus.FAILED, "crash detected", "crash"].includes(normalized)) {
      return DaemonStatus.ERROR;
    }
    return DaemonStatus.UNKNOWN;
  }

  // ===== Daemon Actions =====

  showStartConfirm(): void {
    if (this.state.status === DaemonStatus.RUNNING) {
      this.setStatus("Daemon is already running", MessageType.WARNING);
      return;
    }
    this.state.activeDialog = new ConfirmDialog({
      title: "Start Daemon",
      message: "Are you sure you want to start the daemon?",
      confirmText: "Start",
      cancelText: TUI_LABEL_CANCEL,
    });
  }

  showStopConfirm(): void {
    if (this.state.status !== DaemonStatus.RUNNING) {
      this.setStatus("Daemon is not running", MessageType.WARNING);
      return;
    }
    this.state.activeDialog = new ConfirmDialog({
      title: "Stop Daemon",
      message: [
        "Are you sure you want to stop the daemon?",
        "All active operations will be terminated.",
      ],
      confirmText: "Stop",
      cancelText: TUI_LABEL_CANCEL,
      destructive: true,
    });
  }

  showRestartConfirm(): void {
    this.state.activeDialog = new ConfirmDialog({
      title: "Restart Daemon",
      message: [
        "Are you sure you want to restart the daemon?",
        "All active operations will be temporarily interrupted.",
      ],
      confirmText: "Restart",
      cancelText: TUI_LABEL_CANCEL,
      destructive: true,
    });
  }

  async startDaemon(): Promise<void> {
    this.localSpinnerState = startSpinner(this.localSpinnerState, "Starting daemon...");
    try {
      await this.daemonView.start();
      await this.refreshStatus();
      this.setStatus("Daemon started successfully", MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to start daemon: ${msg}`, MessageType.ERROR);
    } finally {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  async stopDaemon(): Promise<void> {
    this.localSpinnerState = startSpinner(this.localSpinnerState, "Stopping daemon...");
    try {
      await this.daemonView.stop();
      await this.refreshStatus();
      this.setStatus("Daemon stopped successfully", MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to stop daemon: ${msg}`, MessageType.ERROR);
    } finally {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  async restartDaemon(): Promise<void> {
    this.localSpinnerState = startSpinner(this.localSpinnerState, "Restarting daemon...");
    try {
      await this.daemonView.restart();
      await this.refreshStatus();
      this.setStatus("Daemon restarted successfully", MessageType.SUCCESS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Failed to restart daemon: ${msg}`, MessageType.ERROR);
    } finally {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  // ===== Logs View =====

  async showLogs(): Promise<void> {
    this.localSpinnerState = startSpinner(this.localSpinnerState, "Loading logs...");
    try {
      this.state.logContent = await this.daemonView.getLogs();
      this.state.errorContent = await this.daemonView.getErrors();
      this.state.showLogs = true;
    } finally {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  hideLogs(): void {
    this.state.showLogs = false;
  }

  // ===== Config View =====

  showConfig(): void {
    this.state.showConfig = true;
  }

  hideConfig(): void {
    this.state.showConfig = false;
  }

  // ===== Auto-Refresh =====

  toggleAutoRefresh(): void {
    this.state.autoRefresh = !this.state.autoRefresh;
    if (this.state.autoRefresh) {
      this.startDaemonAutoRefresh();
    } else {
      this.stopDaemonAutoRefresh();
    }
  }

  private startDaemonAutoRefresh(): void {
    if (this.autoRefreshTimer === null) {
      this.autoRefreshTimer = setInterval(() => {
        this.refreshStatus();
      }, this.state.autoRefreshInterval);
    }
  }

  private stopDaemonAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  // ===== Help Screen =====

  override toggleHelp(): void {
    this.state.showHelp = !this.state.showHelp;
  }

  getHelpSections(): IHelpSection[] {
    return [
      {
        title: "Daemon Actions",
        items: [
          { key: "s", description: HELP_START_DESC },
          { key: "k", description: HELP_STOP_DESC },
          { key: "r", description: HELP_RESTART_DESC },
        ],
      },
      {
        title: "View",
        items: [
          { key: "l", description: HELP_LOGS_DESC },
          { key: "c", description: HELP_CONFIG_DESC },
          { key: "R", description: HELP_REFRESH_DESC },
          { key: "a", description: HELP_AUTO_REFRESH_DESC },
        ],
      },
      {
        title: "General",
        items: [
          { key: "?", description: HELP_HELP_DESC },
          { key: "q/Esc", description: HELP_QUIT_DESC },
        ],
      },
    ];
  }

  // ===== Dialog Handling =====

  private pendingDialogAction: DaemonAction | null = null;

  async closeDialog(): Promise<void> {
    if (this.state.activeDialog) {
      const result = this.state.activeDialog.getResult();
      if (result.type === DialogStatus.CONFIRMED && this.pendingDialogAction) {
        // Execute the pending action
        const action = this.pendingDialogAction;
        this.pendingDialogAction = null;
        this.state.activeDialog = null;

        switch (action) {
          case DaemonAction.START:
            await this.startDaemon();
            break;
          case DaemonAction.STOP:
            await this.stopDaemon();
            break;
          case DaemonAction.RESTART:
            await this.restartDaemon();
            break;
        }
      } else {
        this.pendingDialogAction = null;
        this.state.activeDialog = null;
      }
    }
  }

  // ===== Key Handling =====

  async handleKey(key: string): Promise<boolean> {
    if (await this.handleDialogKey(key)) return true;
    if (this.handleOverlayViewKey(key)) return true;
    return await this.handleMainViewKey(key);
  }

  private async handleDialogKey(key: string): Promise<boolean> {
    if (!this.state.activeDialog) return false;
    this.state.activeDialog.handleKey(key);
    if (!this.state.activeDialog.isActive()) {
      await this.closeDialog();
    }
    return true;
  }

  private handleOverlayViewKey(key: string): boolean {
    if (this.state.showLogs) {
      if (key === KEYS.ESCAPE || key === KEYS.Q) {
        this.hideLogs();
      }
      return true;
    }

    if (this.state.showConfig) {
      if (key === KEYS.ESCAPE || key === KEYS.Q) {
        this.hideConfig();
      }
      return true;
    }

    if (this.state.showHelp) {
      if (key === KEYS.ESCAPE || key === KEYS.Q || key === KEYS.QUESTION) {
        this.state.showHelp = false;
      }
      return true;
    }

    return false;
  }

  private async handleMainViewKey(key: string): Promise<boolean> {
    switch (key) {
      case KEYS.S:
        this.pendingDialogAction = DaemonAction.START;
        this.showStartConfirm();
        return true;
      case "k":
        this.pendingDialogAction = DaemonAction.STOP;
        this.showStopConfirm();
        return true;
      case KEYS.R:
        this.pendingDialogAction = DaemonAction.RESTART;
        this.showRestartConfirm();
        return true;
      case KEYS.L:
        await this.showLogs();
        return true;
      case KEYS.C:
        this.showConfig();
        return true;
      case KEYS.CAP_R:
        await this.refreshStatus();
        return true;
      case KEYS.A:
        this.toggleAutoRefresh();
        return true;
      case KEYS.QUESTION:
        this.state.showHelp = true;
        return true;
      default:
        return false;
    }
  }

  // ===== Rendering =====

  renderStatusPanel(): string[] {
    const lines: string[] = [];
    const statusIcon = DAEMON_STATUS_ICONS[this.state.status] || "❓";
    const statusLabel = this.state.status.charAt(0).toUpperCase() + this.state.status.slice(1);

    lines.push(TUI_SECTION.TOP);
    lines.push(`║${"DAEMON STATUS".padStart(38).padEnd(61)}║`);
    lines.push(TUI_SECTION.MIDDLE);
    lines.push(`║  Status: ${statusIcon} ${statusLabel.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 9)} ║`);

    if (this.state.lastStatusCheck) {
      const timeStr = this.state.lastStatusCheck.toLocaleTimeString();
      lines.push(`║  Last Check: ${timeStr.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 12)} ║`);
    }

    if (this.state.autoRefresh) {
      lines.push(
        `║  Auto-refresh: ON (every ${Math.floor(this.state.autoRefreshInterval / 1000)}s)${
          "".padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 26)
        } ║`,
      );
    } else {
      lines.push(`║  Auto-refresh: OFF${"".padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 16)} ║`);
    }

    lines.push("║                                                               ║");

    // Show errors if any
    if (this.state.errorContent.length > 0) {
      lines.push("║  ⚠️  Recent Errors:                                            ║");
      for (const error of this.state.errorContent.slice(0, 3)) {
        const truncated = error.length > TUI_LAYOUT_MEDIUM_WIDTH - 3
          ? error.substring(0, TUI_LAYOUT_MEDIUM_WIDTH - 6) + "..."
          : error;
        lines.push(`║    ${truncated.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 1)} ║`);
      }
      lines.push("║                                                               ║");
    }

    lines.push(TUI_SECTION.MIDDLE);
    lines.push(`║${UI_STATUS_PANEL_KEYS.padEnd(61)}║`);
    lines.push(TUI_SECTION.BOTTOM);

    return lines;
  }

  renderLogs(): string[] {
    const lines: string[] = [];
    lines.push(TUI_SECTION.TOP);
    lines.push(`║${"DAEMON LOGS".padStart(37).padEnd(61)}║`);
    lines.push(TUI_SECTION.MIDDLE);

    if (this.state.logContent.length > 0) {
      for (const log of this.state.logContent.slice(-15)) {
        const truncated = log.length > TUI_LAYOUT_MEDIUM_WIDTH + 1
          ? log.substring(0, TUI_LAYOUT_MEDIUM_WIDTH - 2) + "..."
          : log;
        lines.push(`║ ${truncated.padEnd(TUI_LAYOUT_MEDIUM_WIDTH + 3)} ║`);
      }
    } else {
      lines.push("║  (No logs available)                                          ║");
    }

    if (this.state.errorContent.length > 0) {
      lines.push(TUI_SECTION.MIDDLE);
      lines.push(`║${"ERRORS".padStart(34).padEnd(61)}║`);
      lines.push(TUI_SECTION.MIDDLE);
      for (const error of this.state.errorContent.slice(-5)) {
        const truncated = error.length > TUI_LAYOUT_MEDIUM_WIDTH + 1
          ? error.substring(0, TUI_LAYOUT_MEDIUM_WIDTH - 2) + "..."
          : error;
        lines.push(`║ ⚠️ ${truncated.padEnd(TUI_LAYOUT_MEDIUM_WIDTH)} ║`);
      }
    }

    lines.push(TUI_SECTION.BOTTOM);
    lines.push("");
    lines.push(UI_CLOSE_LOGS);
    return lines;
  }

  renderConfig(): string[] {
    const lines: string[] = [];
    lines.push(TUI_SECTION.TOP);
    lines.push(`║${"DAEMON CONFIGURATION".padStart(41).padEnd(61)}║`);
    lines.push(TUI_SECTION.MIDDLE);
    lines.push(`║  Config File: ${UI_CONFIG_FILE.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 13)} ║`);
    lines.push(TUI_SECTION.EMPTY);
    lines.push(`║  ${UI_CONFIG_COMING_SOON.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 2)} ║`);
    lines.push(TUI_SECTION.EMPTY);
    lines.push(TUI_SECTION.BOTTOM);
    lines.push("");
    lines.push(UI_CLOSE_CONFIG);
    return lines;
  }

  renderHelp(): string[] {
    return renderHelpScreen({
      title: "Daemon Control Help",
      sections: this.getHelpSections(),
      useColors: this.useColors,
    });
  }

  // ===== Focusable Elements =====

  getFocusableElements(): string[] {
    if (this.state.activeDialog) {
      return this.state.activeDialog.getFocusableElements();
    }
    if (this.state.showLogs || this.state.showConfig || this.state.showHelp) {
      return ["close-button"];
    }
    return ["start-button", "stop-button", "restart-button", "logs-button", "refresh-button"];
  }

  // ===== Lifecycle =====

  override dispose(): void {
    this.stopDaemonAutoRefresh();
    super.dispose();
  }
}

// ===== Legacy Support =====

/**
 * Legacy TUI session for backwards compatibility
 * @deprecated Use DaemonControlTuiSession instead
 */
export class LegacyDaemonControlTuiSession extends TuiSessionBase {
  private readonly daemonView: DaemonControlView;
  private status = "unknown";

  constructor(daemonView: DaemonControlView, useColors = true) {
    super(useColors);
    this.daemonView = daemonView;
  }

  async initialize(): Promise<void> {
    this.status = await this.daemonView.getStatus();
  }

  getStatus(): string {
    return this.status;
  }

  getFocusableElements(): string[] {
    return ["start", "stop", "restart", "logs", CLI_CMD_STATUS];
  }
}
