/**
 * @module TreeViewStateModule
 * @path packages/tui/src/base/tree_view_state.ts
 * @description Common state interfaces and factory functions for tree-based TUI views.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files ["packages/tui/src/base/base_tree_view.ts"]
 */

import type { DialogBase } from "@exaix/tui/helpers/dialog_base.ts";
import type { ITreeNode } from "@exaix/tui/helpers/tree_view.ts";
import { DEFAULT_REFRESH_INTERVAL_MS } from "@exaix/core";

export interface ITreeViewState<T> {
  selectedId: string | null;
  tree: ITreeNode<T>[];
  filterText: string;
  isLoading: boolean;
  loadingMessage: string;
  showHelp: boolean;
  activeDialog: DialogBase | null;
  useColors: boolean;
  spinnerFrame: number;
  lastRefresh: number;
  scrollOffset: number;
  refreshConfig: {
    enabled: boolean;
    intervalMs: number;
    lastRefresh: number;
  };
}

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
