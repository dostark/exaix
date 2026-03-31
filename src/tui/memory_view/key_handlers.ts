/**
 * @module MemoryKeyHandlers
 * @path src/tui/memory_view/key_handlers.ts
 * @description Key handler utilities for Memory View, extracting complex keyboard logic for navigation, search, and shortcuts.
 * @architectural-layer TUI
 * * @related-files [src/helpers/keyboard.ts, src/tui/memory_view/memory_scope.ts]
 */

import type { ITreeNode } from "./types.ts";
import { KEYS } from "../helpers/keyboard.ts";
import { MemoryTuiScope } from "./memory_scope.ts";

export interface IShortcutHandlers {
  jumpToScope?: (scope: string) => Promise<void>;
  startSearch?: () => void;
  showHelp?: () => void;
  approveProposal?: () => Promise<void>;
  rejectProposal?: () => Promise<void>;
  approveAll?: () => Promise<void>;
  addLearning?: () => void;
  promoteLearning?: () => void;
  refresh?: () => Promise<void>;
}

/**
 * Consolidates all key handlers for Memory View
 */
export class KeyHandler {
  /**
   * Handle search mode key input
   */
  static handleSearchKey(
    key: string,
    searchQuery: string,
    onEscape: () => void,
    onEnter: () => void,
  ): { handled: boolean; newQuery?: string } {
    return SearchModeHandler.handleKey(key, searchQuery, onEscape, onEnter);
  }

  /**
   * Handle navigation key input
   */
  static async handleNavigationKey(
    key: string,
    flatNodes: ITreeNode[],
    currentNodeId: string | null,
    onNavigate: (nodeId: string, node: ITreeNode) => Promise<void>,
  ): Promise<boolean> {
    return await NavigationHandler.handleKey(key, flatNodes, currentNodeId, onNavigate);
  }

  /**
   * Handle shortcut key input
   */
  static async handleShortcutKey(
    key: string,
    handlers: IShortcutHandlers,
  ): Promise<boolean> {
    return await ShortcutHandler.handleKey(key, handlers);
  }
}

/**
 * Internal search mode handler
 */
class SearchModeHandler {
  static handleKey(
    key: string,
    searchQuery: string,
    onEscape: () => void,
    onEnter: () => void,
  ): { handled: boolean; newQuery?: string } {
    if (key === KEYS.ESCAPE) {
      onEscape();
      return { handled: true };
    }
    if (key === KEYS.ENTER) {
      onEnter();
      return { handled: true };
    }
    if (key === KEYS.BACKSPACE) {
      return { handled: true, newQuery: searchQuery.slice(0, -1) };
    }
    if (key.length === 1) {
      return { handled: true, newQuery: searchQuery + key };
    }
    return { handled: true };
  }
}

/**
 * Internal navigation handler
 */
class NavigationHandler {
  static async handleKey(
    key: string,
    flatNodes: ITreeNode[],
    currentNodeId: string | null,
    onNavigate: (nodeId: string, node: ITreeNode) => Promise<void>,
  ): Promise<boolean> {
    if (flatNodes.length === 0) return false;

    const currentIndex = flatNodes.findIndex((n) => n.id === currentNodeId);

    switch (key) {
      case KEYS.UP:
        if (currentIndex > 0) {
          const node = flatNodes[currentIndex - 1];
          await onNavigate(node.id, node);
        }
        return true;
      case KEYS.DOWN:
        if (currentIndex < flatNodes.length - 1) {
          const node = flatNodes[currentIndex + 1];
          await onNavigate(node.id, node);
        }
        return true;
      case KEYS.HOME:
        if (flatNodes.length > 0) {
          const node = flatNodes[0];
          await onNavigate(node.id, node);
        }
        return true;
      case KEYS.END:
        if (flatNodes.length > 0) {
          const node = flatNodes[flatNodes.length - 1];
          await onNavigate(node.id, node);
        }
        return true;
    }
    return false;
  }
}

/**
 * Internal shortcut handler
 */
class ShortcutHandler {
  static async handleKey(
    key: string,
    handlers: IShortcutHandlers,
  ): Promise<boolean> {
    // Handle scope navigation
    if (await this.handleScopeNavigation(key, handlers)) return true;

    // Handle search and help
    if (this.handleSearchAndHelp(key, handlers)) return true;

    // Handle proposal actions
    if (await this.handleProposalActions(key, handlers)) return true;

    // Handle learning actions
    if (this.handleLearningActions(key, handlers)) return true;

    // Handle global actions
    if (await this.handleGlobalActions(key, handlers)) return true;

    return false;
  }

  /**
   * Handle scope navigation keys (G, P, E, N)
   */
  private static async handleScopeNavigation(
    key: string,
    handlers: IShortcutHandlers,
  ): Promise<boolean> {
    if (!handlers.jumpToScope) return false;

    switch (key) {
      case KEYS.G:
        await handlers.jumpToScope(MemoryTuiScope.GLOBAL);
        return true;
      case KEYS.P:
        await handlers.jumpToScope(MemoryTuiScope.PROJECTS);
        return true;
      case KEYS.E:
        await handlers.jumpToScope(MemoryTuiScope.EXECUTIONS);
        return true;
      case KEYS.N:
        await handlers.jumpToScope(MemoryTuiScope.PENDING);
        return true;
    }
    return false;
  }

  /**
   * Handle search and help keys (S, /, ?)
   */
  private static handleSearchAndHelp(
    key: string,
    handlers: IShortcutHandlers,
  ): boolean {
    switch (key) {
      case KEYS.S:
      case KEYS.SLASH:
        if (handlers.startSearch) handlers.startSearch();
        return true;
      case KEYS.QUESTION:
        if (handlers.showHelp) handlers.showHelp();
        return true;
    }
    return false;
  }

  /**
   * Handle proposal actions (A, R, Shift+A)
   */
  private static async handleProposalActions(
    key: string,
    handlers: IShortcutHandlers,
  ): Promise<boolean> {
    switch (key) {
      case KEYS.A:
        if (handlers.approveProposal) await handlers.approveProposal();
        return true;
      case KEYS.R:
        if (handlers.rejectProposal) await handlers.rejectProposal();
        return true;
      case KEYS.CAP_A:
        if (handlers.approveAll) await handlers.approveAll();
        return true;
    }
    return false;
  }

  /**
   * Handle learning actions (L, Shift+P)
   */
  private static handleLearningActions(
    key: string,
    handlers: IShortcutHandlers,
  ): boolean {
    switch (key) {
      case KEYS.L:
        if (handlers.addLearning) handlers.addLearning();
        return true;
      case KEYS.CAP_P:
        if (handlers.promoteLearning) handlers.promoteLearning();
        return true;
    }
    return false;
  }

  /**
   * Handle global actions (Shift+R)
   */
  private static async handleGlobalActions(
    key: string,
    handlers: IShortcutHandlers,
  ): Promise<boolean> {
    switch (key) {
      case KEYS.CAP_R:
        if (handlers.refresh) await handlers.refresh();
        return true;
    }
    return false;
  }
}
