/**
 * @module RequestKeyHandlers
 * @path src/tui/request_manager/key_handlers.ts
 * @description Keyboard interaction logic for the Request Manager View, including tree navigation, filtering, and action routing.
 * @architectural-layer TUI
 * * @related-files [src/tui/request_manager_view.ts]
 */

import { KEYS } from "../helpers/keyboard.ts";
import { NavDirection, type RequestGroupingMode as _RequestGroupingMode, TuiNodeType } from "../../shared/enums.ts";
import type { ITreeNode } from "../helpers/tree_view.ts";
import { collapseAll, expandAll, findNode, flattenTree, toggleNode } from "../helpers/tree_view.ts";

/**
 * Navigation handler for tree navigation
 */
export class NavigationHandler {
  /**
   * Navigate tree in specified direction
   */
  static navigate(
    tree: ITreeNode[],
    selectedId: string | null,
    direction: NavDirection,
  ): string | null {
    const flat = flattenTree(tree);
    if (flat.length === 0) return null;

    const currentIdx = selectedId ? flat.findIndex((n) => n.node.id === selectedId) : -1;

    let newIdx: number;
    switch (direction) {
      case NavDirection.UP:
        newIdx = currentIdx > 0 ? currentIdx - 1 : 0;
        break;
      case NavDirection.DOWN:
        newIdx = currentIdx < flat.length - 1 ? currentIdx + 1 : flat.length - 1;
        break;
      case NavDirection.FIRST:
        newIdx = 0;
        break;
      case NavDirection.LAST:
        newIdx = flat.length - 1;
        break;
    }

    return flat[newIdx]?.node.id || null;
  }
}

/**
 * Tree manipulation handler for expand/collapse operations
 */
export class TreeManipulationHandler {
  /**
   * Expand selected node if it's a collapsed group
   */
  static expandNode(tree: ITreeNode[], selectedId: string | null): ITreeNode[] {
    if (!selectedId) return tree;
    const node = findNode(tree, selectedId);
    if (node && node.type === TuiNodeType.GROUP && !node.expanded) {
      return toggleNode(tree, selectedId);
    }
    return tree;
  }

  /**
   * Collapse selected node if it's an expanded group
   */
  static collapseNode(tree: ITreeNode[], selectedId: string | null): ITreeNode[] {
    if (!selectedId) return tree;
    const node = findNode(tree, selectedId);
    if (node && node.type === TuiNodeType.GROUP && node.expanded) {
      return toggleNode(tree, selectedId);
    }
    return tree;
  }

  /**
   * Toggle selected node expansion state
   */
  static toggleNode(tree: ITreeNode[], selectedId: string | null): ITreeNode[] {
    if (!selectedId) return tree;
    return toggleNode(tree, selectedId);
  }

  /**
   * Collapse all nodes in tree
   */
  static collapseAll(tree: ITreeNode[]): ITreeNode[] {
    return collapseAll(tree);
  }

  /**
   * Expand all nodes in tree
   */
  static expandAll(tree: ITreeNode[]): ITreeNode[] {
    return expandAll(tree);
  }
}

/**
 * Check if a node ID represents a group node
 */
export function isGroupNode(tree: ITreeNode[], nodeId: string): boolean {
  const node = findNode(tree, nodeId);
  return node?.type === TuiNodeType.GROUP;
}
/**
 * Main key handler for Request Manager view
 */
export class MainKeyHandler {
  /**
   * Handle main view keyboard keys
   */
  static async handle(
    key: string,
    state: {
      selectedRequestId: string | null;
      requestTree: ITreeNode[];
    },
    actions: {
      navigateTree: (dir: NavDirection) => void;
      collapseSelectedNode: () => void;
      expandSelectedNode: () => void;
      toggleSelectedNode: () => void;
      toggleGrouping: () => void;
      refresh: () => Promise<void>;
      showRequestDetail: (id: string) => Promise<void>;
      showCreateDialog: () => void;
      showCancelConfirm: (id: string) => void;
      showPriorityDialog: () => void;
      showSearchDialog: () => void;
      showFilterStatusDialog: () => void;
      showFilterIdentityDialog: () => void;
      toggleShowArchived: () => void;
      setShowHelp: (show: boolean) => void;
      updateTree: (tree: ITreeNode[]) => void;
    },
  ): Promise<boolean> {
    // Handle navigation keys
    if (this.handleNavigationKeys(key, actions)) return true;

    // Handle tree manipulation keys
    if (this.handleTreeKeys(key, actions)) return true;

    // Handle action keys
    if (await this.handleActionKeys(key, state, actions)) return true;

    // Handle filter and search keys
    if (this.handleFilterKeys(key, actions)) return true;

    // Handle global keys
    if (this.handleGlobalKeys(key, state, actions)) return true;

    return false;
  }

  /**
   * Handle navigation keys (up, down, home, end)
   */
  private static handleNavigationKeys(
    key: string,
    actions: { navigateTree: (dir: NavDirection) => void },
  ): boolean {
    switch (key) {
      case KEYS.UP:
        actions.navigateTree(NavDirection.UP);
        return true;
      case KEYS.DOWN:
        actions.navigateTree(NavDirection.DOWN);
        return true;
      case KEYS.HOME:
        actions.navigateTree(NavDirection.FIRST);
        return true;
      case KEYS.END:
        actions.navigateTree(NavDirection.LAST);
        return true;
    }
    return false;
  }

  /**
   * Handle tree manipulation keys (left, right, enter for groups)
   */
  private static handleTreeKeys(
    key: string,
    actions: {
      collapseSelectedNode: () => void;
      expandSelectedNode: () => void;
      toggleSelectedNode: () => void;
    },
  ): boolean {
    switch (key) {
      case KEYS.LEFT:
        actions.collapseSelectedNode();
        return true;
      case KEYS.RIGHT:
        actions.expandSelectedNode();
        return true;
    }
    return false;
  }

  /**
   * Handle action keys (enter for details, create, delete, priority)
   */
  private static async handleActionKeys(
    key: string,
    state: { selectedRequestId: string | null; requestTree: ITreeNode[] },
    actions: {
      toggleSelectedNode: () => void;
      showRequestDetail: (id: string) => Promise<void>;
      showCreateDialog: () => void;
      showCancelConfirm: (id: string) => void;
      showPriorityDialog: () => void;
    },
  ): Promise<boolean> {
    switch (key) {
      case KEYS.ENTER:
        if (state.selectedRequestId) {
          if (isGroupNode(state.requestTree, state.selectedRequestId)) {
            actions.toggleSelectedNode();
          } else {
            await actions.showRequestDetail(state.selectedRequestId);
          }
        }
        return true;
      case KEYS.C:
        actions.showCreateDialog();
        return true;
      case KEYS.D:
        if (state.selectedRequestId && !isGroupNode(state.requestTree, state.selectedRequestId)) {
          actions.showCancelConfirm(state.selectedRequestId);
        }
        return true;
      case KEYS.P:
        if (state.selectedRequestId && !isGroupNode(state.requestTree, state.selectedRequestId)) {
          actions.showPriorityDialog();
        }
        return true;
    }
    return false;
  }

  /**
   * Handle filter and search keys
   */
  private static handleFilterKeys(
    key: string,
    actions: {
      showSearchDialog: () => void;
      showFilterStatusDialog: () => void;
      showFilterIdentityDialog: () => void;
    },
  ): boolean {
    switch (key) {
      case KEYS.S:
        actions.showSearchDialog();
        return true;
      case KEYS.F:
        actions.showFilterStatusDialog();
        return true;
      case KEYS.A:
        actions.showFilterIdentityDialog();
        return true;
    }
    return false;
  }

  /**
   * Handle global keys (grouping, refresh, help, quit)
   */
  private static handleGlobalKeys(
    key: string,
    state: { requestTree: ITreeNode[] },
    actions: {
      toggleGrouping: () => void;
      toggleShowArchived: () => void;
      refresh: () => Promise<void>;
      setShowHelp: (show: boolean) => void;
      updateTree: (tree: ITreeNode[]) => void;
    },
  ): boolean {
    switch (key) {
      case KEYS.G:
        actions.toggleGrouping();
        return true;
      case KEYS.H:
        actions.toggleShowArchived();
        return true;
      case KEYS.R:
        actions.refresh();
        return true;
      case KEYS.CAP_C:
        actions.updateTree(TreeManipulationHandler.collapseAll(state.requestTree));
        return true;
      case KEYS.CAP_E:
        actions.updateTree(TreeManipulationHandler.expandAll(state.requestTree));
        return true;
      case KEYS.QUESTION:
        actions.setShowHelp(true);
        return true;
      case KEYS.Q:
      case KEYS.ESCAPE:
        return true;
    }
    return false;
  }
}
