/**
 * @module TreeViewStateModule
 * @path src/tui/base/tree_view_state.ts
 * @description Common state interfaces and factory functions for tree-based TUI views.
 * @architectural-layer TUI
 * @related-files [src/tui/base/base_tree_view.ts]
 */

import type { DialogBase } from "../helpers/dialog_base.ts";
import type { ITreeNode } from "../helpers/tree_view.ts";
import { DEFAULT_REFRESH_INTERVAL_MS } from "@exaix/core";

/**
 * Common state for tree-based views
 * @template T The type of data stored in tree nodes
 */
export interface ITreeViewState<T> {
  /** Currently selected node ID */
  selectedId: string | null;

  /** Tree structure organized by groups */
  tree: ITreeNode<T>[];

  /** Filter text for searching */
  filterText: string;

  /** Whether view is loading */
  isLoading: boolean;

  /** Loading message to display */
  loadingMessage: string;

  /** Show help screen */
  showHelp: boolean;

  /** Active dialog (if any) */
  activeDialog: DialogBase | null;

  /** Use colors in rendering */
  useColors: boolean;

  /** Spinner frame for animation */
  spinnerFrame: number;

  /** Last refresh timestamp */
  lastRefresh: number;

  /** Scroll offset for list */
  scrollOffset: number;

  /** Refresh configuration */
  refreshConfig: {
    enabled: boolean;
    intervalMs: number;
    lastRefresh: number;
  };
}

/**
 * Factory function to create initial tree view state
 */
export function createTreeViewState<T>(): ITreeViewState<T> {
  return {
    selectedId: null,
    tree: [],
    filterText: "",
    isLoading: false,
    loadingMessage: "",
    showHelp: false,
    activeDialog: null,
    useColors: true,
    spinnerFrame: 0,
    lastRefresh: 0,
    scrollOffset: 0,
    refreshConfig: {
      enabled: false,
      intervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      lastRefresh: 0,
    },
  };
}
