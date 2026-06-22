/**
 * @module BaseTreeViewModule
 * @path packages/tui/src/base/base_tree_view.ts
 * @description Abstract base class for tree-based TUI views, implementing common state management, navigation, and rendering logic.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files ["packages/tui/src/base/tui_session_base.ts", "packages/tui/src/base/tree_view_state.ts"]
 */

import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { TuiSessionBase } from "@exaix/tui/base/tui_session_base.ts";
import type { DialogBase } from "@exaix/tui/helpers/dialog_base.ts";
import { ConfirmDialog, InputDialog } from "@exaix/tui/helpers/dialog_base.ts";
import type { IKeyBinding } from "@exaix/tui/helpers/keyboard.ts";
import { nextFrame, renderSpinner, type SpinnerState, startSpinner, stopSpinner } from "@exaix/tui/helpers/spinner.ts";
import {
  collapseAll,
  expandAll,
  flattenTree,
  getNextNodeId,
  getPrevNodeId,
  type ITreeNode,
  renderTree,
  toggleNode,
  type TreeRenderOptions,
} from "@exaix/tui/helpers/tree_view.ts";
import { createTreeViewState, type ITreeViewState } from "@exaix/tui/base/tree_view_state.ts";
import type { Opt, Reason } from "@exaix/core/types";

export abstract class BaseTreeView<T> extends TuiSessionBase {
  public state: ITreeViewState<T>;
  protected localSpinnerState: SpinnerState;

  constructor(useColors = true) {
    super(useColors);
    this.state = createTreeViewState<T>();
    this.state.useColors = useColors;
    this.localSpinnerState = {
      active: false,
      frame: 0,
      message: "",
      startTime: 0,
    };
  }

  protected abstract buildTree(items: T[]): void;

  abstract override getKeyBindings(): IKeyBinding<string>[];

  abstract override getViewName(): string;

  protected navigateUp(): void {
    if (!this.state.selectedId) {
      this.navigateEnd();
      return;
    }
    const prevId = getPrevNodeId(this.state.tree, this.state.selectedId);
    if (prevId) {
      this.state.selectedId = prevId;
      this.syncSelectedIndex();
    }
  }

  protected navigateDown(): void {
    if (!this.state.selectedId) {
      this.navigateHome();
      return;
    }
    const nextId = getNextNodeId(this.state.tree, this.state.selectedId);
    if (nextId) {
      this.state.selectedId = nextId;
      this.syncSelectedIndex();
    }
  }

  protected navigateHome(): void {
    const flat = flattenTree(this.state.tree);
    if (flat.length > 0) {
      this.state.selectedId = flat[0].node.id;
      this.selectedIndex = 0;
    }
  }

  protected navigateEnd(): void {
    const flat = flattenTree(this.state.tree);
    if (flat.length > 0) {
      this.state.selectedId = flat[flat.length - 1].node.id;
      this.selectedIndex = flat.length - 1;
    }
  }

  protected toggleCurrentNode(): void {
    if (this.state.selectedId) {
      this.state.tree = toggleNode(this.state.tree, this.state.selectedId);
    }
  }

  protected expandAllNodes(): void {
    this.state.tree = expandAll(this.state.tree);
  }

  protected collapseAllNodes(): void {
    this.state.tree = collapseAll(this.state.tree);
  }

  protected syncSelectedIndex(): void {
    if (!this.state.selectedId) {
      this.selectedIndex = 0;
      return;
    }
    const flat = flattenTree(this.state.tree);
    const idx = flat.findIndex((item) => item.node.id === this.state.selectedId);
    if (idx !== -1) {
      this.selectedIndex = idx;
    }
  }

  public override setSelectedIndex(idx: number, length: number): void {
    super.setSelectedIndex(idx, length);
    const flat = flattenTree(this.state.tree);
    if (idx >= 0 && idx < flat.length) {
      this.state.selectedId = flat[idx].node.id;
    } else {
      this.state.selectedId = null;
    }
  }

  protected handleNavigationKeys(key: string): boolean {
    switch (key) {
      case KEYS.UP:
      case KEYS.K:
        this.navigateUp();
        return true;
      case KEYS.DOWN:
      case KEYS.J:
        this.navigateDown();
        return true;
      case KEYS.HOME:
        this.navigateHome();
        return true;
      case KEYS.END:
        this.navigateEnd();
        return true;
      case KEYS.LEFT:
      case KEYS.RIGHT:
        this.toggleCurrentNode();
        return true;
      case KEYS.E:
        this.expandAllNodes();
        return true;
      case KEYS.C:
        this.collapseAllNodes();
        return true;
      case KEYS.SLASH:
        return false;
      case KEYS.ESCAPE:
        if (this.state.filterText !== "") {
          this.state.filterText = "";
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  protected handleHelpKeys(key: string): boolean {
    if (this.state.showHelp) {
      if (key === KEYS.QUESTION || key === KEYS.ESCAPE) {
        this.state.showHelp = false;
        return true;
      }
      return true;
    }

    if (key === KEYS.QUESTION) {
      this.state.showHelp = true;
      return true;
    }

    return false;
  }

  public async handleKey(key: string): Promise<boolean> {
    if (await this.handleDialogKeys(key)) return true;
    if (this.handleHelpKeys(key)) return true;
    if (this.handleNavigationKeys(key)) return true;
    return false;
  }

  protected async handleDialogKeys(key: string): Promise<boolean> {
    if (this.state.activeDialog) {
      this.state.activeDialog.handleKey(key);

      if (!this.state.activeDialog.isActive()) {
        const dialog = this.state.activeDialog;
        this.state.activeDialog = null;
        await this.onDialogClosed(dialog);
      }

      return true;
    }

    return false;
  }

  protected onDialogClosed(_dialog: DialogBase): void | Promise<void> {
    // Default: no-op
  }

  protected showConfirmDialog(options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
  }): void {
    this.state.activeDialog = new ConfirmDialog(options);
  }

  protected showInputDialog(options: {
    title: string;
    label: string;
    placeholder?: string;
    defaultValue?: string;
  }): void {
    this.state.activeDialog = new InputDialog(options);
  }

  protected setLoading(loading: boolean, message = ""): void {
    this.state.isLoading = loading;
    this.state.loadingMessage = message;
    if (loading) {
      this.localSpinnerState = startSpinner(this.localSpinnerState, message);
    } else {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  async executeWithLoading<R>(
    message: string,
    action: () => Promise<R>,
    successMessage?: Opt<(result: R) => string, Reason.UiDefault>,
  ): Promise<R | null> {
    this.setLoading(true, message);
    try {
      const result = await action();
      if (successMessage) {
        this.statusMessage = successMessage(result);
      }
      return result;
    } catch (error) {
      this.statusMessage = error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`;
      return null;
    } finally {
      this.setLoading(false);
    }
  }

  public tickSpinner(): void {
    this.localSpinnerState = nextFrame(this.localSpinnerState);
    this.state.spinnerFrame = this.localSpinnerState.frame % 10;
  }

  protected getSelectedNode(): ITreeNode<T> | null {
    const flat = flattenTree(this.state.tree);
    return flat.find((item) => item.node.id === this.state.selectedId)?.node || null;
  }

  isLoading(): boolean {
    return this.state.isLoading;
  }

  getLoadingMessage(): string {
    return this.state.loadingMessage;
  }

  override isHelpVisible(): boolean {
    return this.state.showHelp;
  }

  hasActiveDialog(): boolean {
    return this.state.activeDialog !== null && this.state.activeDialog.isActive();
  }

  getActiveDialog(): DialogBase | null {
    return this.state.activeDialog;
  }

  setUseColors(useColors: boolean): void {
    this.state.useColors = useColors;
  }

  protected renderTreeView(options: Partial<TreeRenderOptions> = {}): string[] {
    return renderTree(this.state.tree, {
      useColors: this.state.useColors,
      selectedId: this.state.selectedId || undefined,
      ...options,
    });
  }

  renderStatusBar(): string {
    if (this.state.isLoading) {
      return renderSpinner(this.localSpinnerState, { useColors: this.state.useColors });
    }
    return this.statusMessage ? `Status: ${this.statusMessage}` : "Ready";
  }

  getTree(): ITreeNode<T>[] {
    return this.state.tree;
  }
}
