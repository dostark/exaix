/**
 * @module BaseTreeViewModule
 * @path src/tui/base/base_tree_view.ts
 * @description Abstract base class for tree-based TUI views, implementing common state management, navigation, and rendering logic.
 * @architectural-layer TUI
 * * @related-files [src/tui/tui_common.ts, src/tui/base/tree_view_state.ts]
 */

import { KEYS } from "../helpers/keyboard.ts";
import { TuiSessionBase } from "../tui_common.ts";
import type { DialogBase } from "../helpers/dialog_base.ts";
import { ConfirmDialog, InputDialog } from "../helpers/dialog_base.ts";
import type { IKeyBinding } from "../helpers/keyboard.ts";
import { nextFrame, renderSpinner, type SpinnerState, startSpinner, stopSpinner } from "../helpers/spinner.ts";
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
} from "../helpers/tree_view.ts";
import { createTreeViewState, type ITreeViewState } from "./tree_view_state.ts";

/**
 * Abstract base class for tree-based TUI views
 * @template T The type of data stored in tree nodes
 */
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

  // ===== Abstract Methods (must be implemented by subclasses) =====

  /**
   * Build the tree structure from items
   */
  protected abstract buildTree(items: T[]): void;

  /**
   * Get the key bindings for this view
   */
  abstract override getKeyBindings(): IKeyBinding<string>[];

  /**
   * Get the view name
   */
  abstract override getViewName(): string;

  // ===== Navigation Methods =====

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

  /**
   * Navigate to next node in tree
   */
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

  /**
   * Navigate to first node in tree
   */
  protected navigateHome(): void {
    const flat = flattenTree(this.state.tree);
    if (flat.length > 0) {
      this.state.selectedId = flat[0].node.id;
      this.selectedIndex = 0;
    }
  }

  /**
   * Navigate to last node in tree
   */
  protected navigateEnd(): void {
    const flat = flattenTree(this.state.tree);
    if (flat.length > 0) {
      this.state.selectedId = flat[flat.length - 1].node.id;
      this.selectedIndex = flat.length - 1;
    }
  }

  /**
   * Toggle expand/collapse of current node
   */
  protected toggleCurrentNode(): void {
    if (this.state.selectedId) {
      this.state.tree = toggleNode(this.state.tree, this.state.selectedId);
    }
  }

  /**
   * Expand all nodes in tree
   */
  protected expandAllNodes(): void {
    this.state.tree = expandAll(this.state.tree);
  }

  /**
   * Collapse all nodes in tree
   */
  protected collapseAllNodes(): void {
    this.state.tree = collapseAll(this.state.tree);
  }
  protected syncSelectedIndex(): void {
    if (!this.state.selectedId) {
      this.selectedIndex = 0;
      return;
    }
    const flat = flattenTree(this.state.tree);
    const idx = flat.findIndex((f) => f.node.id === this.state.selectedId);
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

  // ===== Key Handling =====

  /**
   * Handle common navigation keys
   * Returns true if key was handled, false otherwise
   */
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
        // By default, search is handled by subclasses if they have a search dialog
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

  /**
   * Handle help screen keys
   * Returns true if key was handled, false otherwise
   */
  protected handleHelpKeys(key: string): boolean {
    if (this.state.showHelp) {
      if (key === KEYS.QUESTION || key === KEYS.ESCAPE) {
        this.state.showHelp = false;
        return true;
      }
      return true; // Consume all keys when help is shown
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

  /**
   * Handle dialog keys
   * Returns true if dialog is active and consumed the key
   */
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

  /**
   * Called when a dialog is closed
   * Subclasses can override to handle dialog results
   */
  /**
   * Called when a dialog is closed
   * Subclasses can override to handle dialog results
   */
  protected onDialogClosed(_dialog: DialogBase): void | Promise<void> {
    // Default: no-op
  }

  // ===== Dialog Management =====

  /**
   * Show a confirmation dialog
   */
  protected showConfirmDialog(options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
  }): void {
    this.state.activeDialog = new ConfirmDialog(options);
  }

  /**
   * Show an input dialog
   */
  protected showInputDialog(options: {
    title: string;
    label: string;
    placeholder?: string;
    defaultValue?: string;
  }): void {
    this.state.activeDialog = new InputDialog(options);
  }

  // ===== Loading State =====

  /**
   * Set loading state
   */
  protected setLoading(loading: boolean, message = ""): void {
    this.state.isLoading = loading;
    this.state.loadingMessage = message;
    if (loading) {
      this.localSpinnerState = startSpinner(this.localSpinnerState, message);
    } else {
      this.localSpinnerState = stopSpinner(this.localSpinnerState);
    }
  }

  /**
   * Execute an async action with loading state and common error handling
   */
  async executeWithLoading<R>(
    message: string,
    action: () => Promise<R>,
    successMessage?: (result: R) => string,
  ): Promise<R | null> {
    this.setLoading(true, message);
    try {
      const result = await action();
      if (successMessage) {
        this.statusMessage = successMessage(result);
      }
      return result;
    } catch (e) {
      this.statusMessage = e instanceof Error ? `Error: ${e.message}` : `Error: ${String(e)}`;
      return null;
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Advance spinner animation frame
   */
  public tickSpinner(): void {
    this.localSpinnerState = nextFrame(this.localSpinnerState);
    this.state.spinnerFrame = this.localSpinnerState.frame % 10;
  }

  // ===== State Accessors =====

  /**
   * Get currently selected node
   */
  protected getSelectedNode(): ITreeNode<T> | null {
    const flat = flattenTree(this.state.tree);
    return flat.find((f) => f.node.id === this.state.selectedId)?.node || null;
  }

  /**
   * Check if loading
   */
  isLoading(): boolean {
    return this.state.isLoading;
  }

  /**
   * Get loading message
   */
  getLoadingMessage(): string {
    return this.state.loadingMessage;
  }

  /**
   * Check if help is visible
   */
  override isHelpVisible(): boolean {
    return this.state.showHelp;
  }

  /**
   * Check if dialog is active
   */
  hasActiveDialog(): boolean {
    return this.state.activeDialog !== null && this.state.activeDialog.isActive();
  }

  /**
   * Get active dialog
   */
  getActiveDialog(): DialogBase | null {
    return this.state.activeDialog;
  }

  /**
   * Set color usage
   */
  setUseColors(useColors: boolean): void {
    this.state.useColors = useColors;
  }

  // ===== Rendering =====

  /**
   * Render the tree
   */
  protected renderTreeView(options: Partial<TreeRenderOptions> = {}): string[] {
    return renderTree(this.state.tree, {
      useColors: this.state.useColors,
      selectedId: this.state.selectedId || undefined,
      ...options,
    });
  }

  /**
   * Render status bar
   */
  renderStatusBar(): string {
    if (this.state.isLoading) {
      return renderSpinner(this.localSpinnerState, { useColors: this.state.useColors });
    }
    return this.statusMessage ? `Status: ${this.statusMessage}` : "Ready";
  }

  /**
   * Get tree for rendering
   */
  getTree(): ITreeNode<T>[] {
    return this.state.tree;
  }
}
