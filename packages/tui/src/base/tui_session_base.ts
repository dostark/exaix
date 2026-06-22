/**
 * @module TuiSessionBase
 * @path packages/tui/src/base/tui_session_base.ts
 * @description Shared TUI session utilities, base classes, and state management patterns used across TUI views.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files ["packages/tui/src/base/base_tree_view.ts"]
 */

import { getTheme, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";
import {
  createSpinnerState,
  nextFrame,
  type SpinnerState,
  startSpinner,
  stopSpinner,
} from "@exaix/tui/helpers/spinner.ts";
import { createStatusBarState, type IStatusBarState, setStatusMessage } from "@exaix/tui/helpers/status_bar.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import type { IKeyBinding, KeyHandler } from "@exaix/tui/helpers/keyboard.ts";
import { MessageType } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export interface ITuiViewState {
  selectedIndex: number;
  itemCount: number;
  scrollOffset: number;
  isLoading: boolean;
  needsRefresh: boolean;
  filterText: string;
  showHelp: boolean;
  activeDialog: string | null;
}

export function createViewState(
  overrides: Opt<Partial<ITuiViewState>, Reason.UiDefault> = {},
): ITuiViewState {
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

export interface IRefreshConfig {
  autoRefreshInterval: number;
  onRefresh: () => Promise<void>;
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

export class TuiSessionBase {
  protected selectedIndex = 0;
  protected statusMessage = "";
  protected spinnerState: SpinnerState;
  protected statusBarState: IStatusBarState;
  protected theme: ITuiTheme;
  protected useColors = true;
  protected viewState: ITuiViewState;
  protected refreshConfig: IRefreshConfig | null = null;
  protected refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(useColors = true) {
    this.useColors = useColors;
    this.theme = getTheme(useColors);
    this.spinnerState = createSpinnerState();
    this.statusBarState = createStatusBarState();
    this.viewState = createViewState();
  }

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

  getStatusMessage(): string {
    return this.statusMessage;
  }

  setStatus(message: string, type: MessageType = MessageType.INFO): void {
    this.statusMessage = message;
    setStatusMessage(this.statusBarState, message, type);
  }

  clearStatus(): void {
    this.statusMessage = "";
    setStatusMessage(this.statusBarState, "");
  }

  isSpinnerActive(): boolean {
    return this.spinnerState.active;
  }

  protected startLoading(message = "Loading..."): void {
    this.spinnerState = startSpinner(this.spinnerState, message);
    this.viewState.isLoading = true;
  }

  protected stopLoading(): void {
    this.spinnerState = stopSpinner(this.spinnerState);
    this.viewState.isLoading = false;
  }

  protected advanceSpinner(): void {
    if (this.spinnerState.active) {
      this.spinnerState = nextFrame(this.spinnerState);
    }
  }

  getSpinnerState(): SpinnerState {
    return this.spinnerState;
  }

  getTheme(): ITuiTheme {
    return this.theme;
  }

  updateColorMode(useColors: boolean): void {
    this.useColors = useColors;
    this.theme = getTheme(useColors);
  }

  getViewState(): ITuiViewState {
    return this.viewState;
  }

  toggleHelp(): void {
    this.viewState.showHelp = !this.viewState.showHelp;
  }

  isHelpVisible(): boolean {
    return this.viewState.showHelp;
  }

  setFilter(text: string): void {
    this.viewState.filterText = text;
  }

  getFilter(): string {
    return this.viewState.filterText;
  }

  setActiveDialogId(dialogId: string | null): void {
    this.viewState.activeDialog = dialogId;
  }

  getActiveDialogId(): string | null {
    return this.viewState.activeDialog;
  }

  hasDialogOpen(): boolean {
    return this.viewState.activeDialog !== null;
  }

  configureRefresh(
    onRefresh: () => Promise<void>,
    intervalMs: Opt<number, Reason.UiDefault> = 0,
  ): void {
    this.refreshConfig = createRefreshConfig(onRefresh, intervalMs);
    if (intervalMs > 0) {
      this.startAutoRefresh();
    }
  }

  protected startAutoRefresh(): void {
    if (this.refreshConfig && this.refreshConfig.enabled && this.refreshTimer === null) {
      this.refreshTimer = setInterval(async () => {
        if (this.refreshConfig && !this.spinnerState.active) {
          await this.refresh();
        }
      }, this.refreshConfig.autoRefreshInterval);
    }
  }

  protected stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

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

  markNeedsRefresh(): void {
    this.viewState.needsRefresh = true;
  }

  protected async performAction(actionFn: () => Promise<unknown>): Promise<void> {
    try {
      await actionFn();
      this.statusMessage = "";
    } catch (error) {
      if (error && typeof error === "object" && "message" in error) {
        this.statusMessage = `Error: ${(error as Error).message}`;
      } else {
        this.statusMessage = `Error: ${String(error)}`;
      }
    }
  }

  protected async performWithLoading<T>(
    actionFn: () => Promise<T>,
    loadingMessage: Opt<string, Reason.UiDefault> = "Working...",
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

  onActivate(): void {
    if (this.viewState.needsRefresh && this.refreshConfig) {
      this.refresh();
    }
    if (this.refreshConfig?.enabled) {
      this.startAutoRefresh();
    }
  }

  onDeactivate(): void {
    this.stopAutoRefresh();
  }

  dispose(): void {
    this.stopAutoRefresh();
  }

  getKeyBindings(): IKeyBinding<KeyHandler | string>[] {
    return [];
  }

  getViewName(): string {
    return "View";
  }
}

export function calculateScrollOffset(
  selectedIndex: number,
  scrollOffset: number,
  visibleHeight: number,
  totalItems: number,
): number {
  if (totalItems <= visibleHeight) {
    return 0;
  }

  if (selectedIndex < scrollOffset) {
    return selectedIndex;
  }

  if (selectedIndex >= scrollOffset + visibleHeight) {
    return selectedIndex - visibleHeight + 1;
  }

  return scrollOffset;
}

export function clampScrollOffset(
  scrollOffset: number,
  visibleHeight: number,
  totalItems: number,
): number {
  const maxOffset = Math.max(0, totalItems - visibleHeight);
  return Math.max(0, Math.min(scrollOffset, maxOffset));
}
