/**
 * @module TuiCommon
 * @path src/tui/tui_common.ts
 * @description Shared TUI session utilities, base classes, and state management patterns used across all dashboard views.
 * @architectural-layer TUI
 * * @related-files [src/tui/base/base_tree_view.ts, src/tui/tui_dashboard.ts]
 */

import { getTheme, type ITuiTheme } from "./helpers/colors.ts";
import { createSpinnerState, nextFrame, type SpinnerState, startSpinner, stopSpinner } from "./helpers/spinner.ts";
import { createStatusBarState, type IStatusBarState, setStatusMessage } from "./helpers/status_bar.ts";
import { KEYS } from "./helpers/keyboard.ts";
import type { IKeyBinding, KeyHandler } from "./helpers/keyboard.ts";
import { MessageType } from "@exaix/core";

// ===== View State Types =====

/**
 * Common state for all TUI views
 */
export interface ITuiViewState {
  /** Currently selected item index */
  selectedIndex: number;
  /** Total number of items */
  itemCount: number;
  /** Scroll offset for virtual scrolling */
  scrollOffset: number;
  /** Whether view is loading */
  isLoading: boolean;
  /** Whether view needs refresh */
  needsRefresh: boolean;
  /** Current filter/search text */
  filterText: string;
  /** Whether help is visible */
  showHelp: boolean;
  /** Active dialog (if any) */
  activeDialog: string | null;
}

/**
 * Create initial view state
 */
export function createViewState(overrides: Partial<ITuiViewState> = {}): ITuiViewState {
  return {
    selectedIndex: 0,
    itemCount: 0,
    scrollOffset: 0,
    isLoading: false,
    needsRefresh: true,
    filterText: "",
    showHelp: false,
    activeDialog: null,
    ...overrides,
  };
}

// ===== Refresh Configuration =====

export interface IRefreshConfig {
  /** Auto-refresh interval in milliseconds (0 = disabled) */
  autoRefreshInterval: number;
  /** Callback when refresh is triggered */
  onRefresh: () => Promise<void>;
  /** Whether refresh is currently enabled */
  enabled: boolean;
}

export function createRefreshConfig(
  onRefresh: () => Promise<void>,
  interval: number = 0,
): IRefreshConfig {
  return {
    autoRefreshInterval: interval,
    onRefresh,
    enabled: interval > 0,
  };
}

// ===== Base Session Class =====

/**
 * Enhanced base class for TUI sessions with modern patterns.
 *
 * Provides:
 * - Navigation handling (up/down/home/end)
 * - Loading state with spinner
 * - Status bar messages
 * - Color theme support
 * - Refresh mechanism
 * - Dialog management
 * - Error handling
 */
export class TuiSessionBase {
  // Navigation state
  protected selectedIndex = 0;

  // Legacy status (for backwards compatibility)
  protected statusMessage = "";

  // Enhanced state
  protected spinnerState: SpinnerState;
  protected statusBarState: IStatusBarState;
  protected theme: ITuiTheme;
  protected useColors = true;

  // View state
  protected viewState: ITuiViewState;

  // Refresh configuration
  protected refreshConfig: IRefreshConfig | null = null;
  protected refreshTimer: number | null = null;

  constructor(useColors = true) {
    this.useColors = useColors;
    this.theme = getTheme(useColors);
    this.spinnerState = createSpinnerState();
    this.statusBarState = createStatusBarState();
    this.viewState = createViewState();
  }

  // ===== Navigation Methods =====

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(idx: number, length: number): void {
    if (idx < 0 || idx >= length) {
      this.selectedIndex = 0;
    } else {
      this.selectedIndex = idx;
    }
  }

  /**
   * Handle navigation keys (up/down/home/end) common to many TUI sessions.
   * Returns true if the key was a navigation key and handled.
   */
  handleNavigationKey(key: string, length: number): boolean {
    if (length === 0) return false;
    switch (key) {
      case KEYS.DOWN:
        this.selectedIndex = Math.min(this.selectedIndex + 1, length - 1);
        return true;
      case "up":
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        return true;
      case "end":
        this.selectedIndex = length - 1;
        return true;
      case "home":
        this.selectedIndex = 0;
        return true;
    }
    return false;
  }

  clampSelection(length: number): void {
    if (this.selectedIndex >= length) {
      this.selectedIndex = Math.max(0, length - 1);
    }
  }

  // ===== Status Methods =====

  getStatusMessage(): string {
    return this.statusMessage;
  }

  /**
   * Set a status message that will auto-clear after duration
   */
  setStatus(message: string, type: MessageType = MessageType.INFO): void {
    this.statusMessage = message;
    setStatusMessage(this.statusBarState, message, type);
  }

  /**
   * Clear status message
   */
  clearStatus(): void {
    this.statusMessage = "";
    setStatusMessage(this.statusBarState, "");
  }

  // ===== Loading State Methods =====

  /**
   * Check if spinner is active (view-level loading)
   */
  isSpinnerActive(): boolean {
    return this.spinnerState.active;
  }

  /**
   * Start loading state with optional message
   */
  protected startLoading(message = "Loading..."): void {
    this.spinnerState = startSpinner(this.spinnerState, message);
    this.viewState.isLoading = true;
  }

  /**
   * Stop loading state
   */
  protected stopLoading(): void {
    this.spinnerState = stopSpinner(this.spinnerState);
    this.viewState.isLoading = false;
  }

  /**
   * Advance spinner animation frame
   */
  protected advanceSpinner(): void {
    if (this.spinnerState.active) {
      this.spinnerState = nextFrame(this.spinnerState);
    }
  }

  /**
   * Get current spinner state for rendering
   */
  getSpinnerState(): SpinnerState {
    return this.spinnerState;
  }

  // ===== Theme Methods =====

  /**
   * Get current theme
   */
  getTheme(): ITuiTheme {
    return this.theme;
  }

  /**
   * Update color mode
   */
  updateColorMode(useColors: boolean): void {
    this.useColors = useColors;
    this.theme = getTheme(useColors);
  }

  // ===== View State Methods =====

  /**
   * Get current view state
   */
  getViewState(): ITuiViewState {
    return this.viewState;
  }

  /**
   * Toggle help display
   */
  toggleHelp(): void {
    this.viewState.showHelp = !this.viewState.showHelp;
  }

  /**
   * Check if help is visible
   */
  isHelpVisible(): boolean {
    return this.viewState.showHelp;
  }

  /**
   * Set filter text
   */
  setFilter(text: string): void {
    this.viewState.filterText = text;
  }

  /**
   * Get filter text
   */
  getFilter(): string {
    return this.viewState.filterText;
  }

  // ===== Dialog Methods =====

  /**
   * Set active dialog ID (for simple string-based dialog tracking)
   */
  setActiveDialogId(dialogId: string | null): void {
    this.viewState.activeDialog = dialogId;
  }

  /**
   * Get active dialog ID
   */
  getActiveDialogId(): string | null {
    return this.viewState.activeDialog;
  }

  /**
   * Check if any dialog is open (by ID)
   */
  hasDialogOpen(): boolean {
    return this.viewState.activeDialog !== null;
  }

  // ===== Refresh Methods =====

  /**
   * Configure auto-refresh
   */
  configureRefresh(onRefresh: () => Promise<void>, intervalMs = 0): void {
    this.refreshConfig = createRefreshConfig(onRefresh, intervalMs);
    if (intervalMs > 0) {
      this.startAutoRefresh();
    }
  }

  /**
   * Start auto-refresh timer
   */
  protected startAutoRefresh(): void {
    if (this.refreshConfig && this.refreshConfig.enabled && this.refreshTimer === null) {
      this.refreshTimer = setInterval(async () => {
        if (this.refreshConfig && !this.spinnerState.active) {
          await this.refresh();
        }
      }, this.refreshConfig.autoRefreshInterval);
    }
  }

  /**
   * Stop auto-refresh timer
   */
  protected stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Manual refresh
   */
  async refresh(): Promise<void> {
    if (this.refreshConfig) {
      this.startLoading("Refreshing...");
      try {
        await this.refreshConfig.onRefresh();
        this.viewState.needsRefresh = false;
        this.setStatus("Refreshed", MessageType.SUCCESS);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.setStatus(`Refresh failed: ${msg}`, MessageType.ERROR);
      } finally {
        this.stopLoading();
      }
    }
  }

  /**
   * Mark view as needing refresh
   */
  markNeedsRefresh(): void {
    this.viewState.needsRefresh = true;
  }

  // ===== Action Methods =====

  /**
   * Perform an async action with error handling
   */
  protected async performAction(actionFn: () => Promise<unknown>): Promise<void> {
    try {
      await actionFn();
      this.statusMessage = "";
    } catch (e) {
      if (e && typeof e === "object" && "message" in e) {
        this.statusMessage = `Error: ${(e as Error).message}`;
      } else {
        this.statusMessage = `Error: ${String(e)}`;
      }
    }
  }

  /**
   * Perform an action with loading state
   */
  protected async performWithLoading<T>(
    actionFn: () => Promise<T>,
    loadingMessage = "Working...",
  ): Promise<T | null> {
    this.startLoading(loadingMessage);
    try {
      const result = await actionFn();
      this.stopLoading();
      return result;
    } catch (error) {
      this.stopLoading();
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`Error: ${msg}`, MessageType.ERROR);
      return null;
    }
  }

  // ===== Lifecycle Methods =====

  /**
   * Called when view is activated
   */
  onActivate(): void {
    if (this.viewState.needsRefresh && this.refreshConfig) {
      this.refresh();
    }
    if (this.refreshConfig?.enabled) {
      this.startAutoRefresh();
    }
  }

  /**
   * Called when view is deactivated
   */
  onDeactivate(): void {
    this.stopAutoRefresh();
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stopAutoRefresh();
  }

  // ===== Optional Override Methods =====

  /**
   * Get key bindings for this view
   * Override in subclasses to provide view-specific bindings
   * The type parameter allows subclasses to use string actions or function handlers
   */
  getKeyBindings(): IKeyBinding<KeyHandler | string>[] {
    return [];
  }

  /**
   * Get the view name for display
   */
  getViewName(): string {
    return "View";
  }
}

// ===== Scrolling Utilities =====

/**
 * Calculate scroll offset to keep selected item visible
 */
export function calculateScrollOffset(
  selectedIndex: number,
  scrollOffset: number,
  visibleHeight: number,
  totalItems: number,
): number {
  if (totalItems <= visibleHeight) {
    return 0;
  }

  // Scroll up if selected is above visible area
  if (selectedIndex < scrollOffset) {
    return selectedIndex;
  }

  // Scroll down if selected is below visible area
  if (selectedIndex >= scrollOffset + visibleHeight) {
    return selectedIndex - visibleHeight + 1;
  }

  return scrollOffset;
}

/**
 * Clamp scroll offset to valid range
 */
export function clampScrollOffset(
  scrollOffset: number,
  visibleHeight: number,
  totalItems: number,
): number {
  const maxOffset = Math.max(0, totalItems - visibleHeight);
  return Math.max(0, Math.min(scrollOffset, maxOffset));
}
