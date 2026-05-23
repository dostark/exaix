/**
 * @module AgentStatusKeyHandlers
 * @path apps/tui/src/agent_status/key_handlers.ts
 * @description Key handler utilities for Agent Status View, managing navigation, expansion, and view mode switching.
 * @architectural-layer TUI
 * @related-files [apps/tui/src/agent_status_view.ts]
 */

import { KEYS } from "@exaix/tui/helpers/keyboard.ts";

// ===== Helper Functions =====

/**
 * Handle navigation keys (up, down, home, end)
 */
function handleNavigationKeys(
  key: string,
  actions: {
    navigateUp?: () => void;
    navigateDown?: () => void;
    navigateToFirst?: () => void;
    navigateToLast?: () => void;
  },
): boolean {
  switch (key) {
    case KEYS.UP:
      if (actions.navigateUp) actions.navigateUp();
      return true;
    case KEYS.DOWN:
      if (actions.navigateDown) actions.navigateDown();
      return true;
    case KEYS.HOME:
      if (actions.navigateToFirst) actions.navigateToFirst();
      return true;
    case KEYS.END:
      if (actions.navigateToLast) actions.navigateToLast();
      return true;
  }
  return false;
}

/**
 * Handle tree expansion keys (left, right)
 */
function handleTreeExpansionKeys(
  key: string,
  actions: {
    collapseSelected?: () => void;
    expandSelected?: () => void;
  },
): boolean {
  switch (key) {
    case KEYS.LEFT:
      if (actions.collapseSelected) actions.collapseSelected();
      return true;
    case KEYS.RIGHT:
      if (actions.expandSelected) actions.expandSelected();
      return true;
  }
  return false;
}

/**
 * Handle action keys (enter, logs)
 */
async function handleActionKeys(
  key: string,
  actions: {
    showAgentDetail?: () => Promise<void>;
    showAgentLogs?: () => Promise<void>;
  },
): Promise<boolean> {
  switch (key) {
    case KEYS.ENTER:
      if (actions.showAgentDetail) await actions.showAgentDetail();
      return true;
    case "l":
      if (actions.showAgentLogs) await actions.showAgentLogs();
      return true;
  }
  return false;
}

/**
 * Handle dialog keys (search)
 */
function handleDialogKeys(
  key: string,
  actions: {
    showSearchDialog?: () => void;
  },
): boolean {
  if (key === KEYS.S) {
    if (actions.showSearchDialog) actions.showSearchDialog();
    return true;
  }
  return false;
}

/**
 * Handle toggle keys (grouping, auto refresh)
 */
function handleToggleKeys(
  key: string,
  actions: {
    toggleGrouping?: () => void;
    toggleAutoRefresh?: () => void;
  },
): boolean {
  switch (key) {
    case KEYS.G:
      if (actions.toggleGrouping) actions.toggleGrouping();
      return true;
    case KEYS.A:
      if (actions.toggleAutoRefresh) actions.toggleAutoRefresh();
      return true;
  }
  return false;
}

/**
 * Handle bulk action keys (collapse/expand all)
 */
function handleBulkActionKeys(
  key: string,
  actions: {
    collapseAllNodes?: () => void;
    expandAllNodes?: () => void;
  },
): boolean {
  switch (key) {
    case KEYS.C:
      if (actions.collapseAllNodes) actions.collapseAllNodes();
      return true;
    case KEYS.CAP_E:
      if (actions.expandAllNodes) actions.expandAllNodes();
      return true;
  }
  return false;
}

/**
 * Handle system keys (refresh, help)
 */
async function handleSystemKeys(
  key: string,
  actions: {
    refreshAgents?: () => Promise<void>;
    toggleHelp?: () => void;
  },
): Promise<boolean> {
  switch (key) {
    case KEYS.CAP_R:
      if (actions.refreshAgents) await actions.refreshAgents();
      return true;
    case KEYS.QUESTION:
      if (actions.toggleHelp) actions.toggleHelp();
      return true;
  }
  return false;
}

/**
 * Handle view mode keys (detail, logs, help)
 */
export class ViewModeHandler {
  static handleKey(
    key: string,
    viewState: {
      showDetail: boolean;
      showLogs: boolean;
      showHelp: boolean;
    },
    actions: {
      hideDetail: () => void;
      hideLogs: () => void;
      toggleHelp: () => void;
    },
  ): boolean {
    // Handle detail view
    if (viewState.showDetail) {
      if (key === KEYS.ESCAPE || key === KEYS.Q) {
        actions.hideDetail();
      }
      return true;
    }

    // Handle logs view
    if (viewState.showLogs) {
      if (key === KEYS.ESCAPE || key === KEYS.Q) {
        actions.hideLogs();
      }
      return true;
    }

    // Handle help view
    if (viewState.showHelp) {
      if (key === KEYS.ESCAPE || key === KEYS.Q || key === KEYS.QUESTION) {
        actions.toggleHelp();
      }
      return true;
    }

    return false;
  }
}

/**
 * Handle main view navigation and action keys
 */
export class MainViewHandler {
  static async handleKey(
    key: string,
    actions: {
      navigateUp?: () => void;
      navigateDown?: () => void;
      navigateToFirst?: () => void;
      navigateToLast?: () => void;
      collapseSelected?: () => void;
      expandSelected?: () => void;
      showAgentDetail?: () => Promise<void>;
      showAgentLogs?: () => Promise<void>;
      showSearchDialog?: () => void;
      toggleGrouping?: () => void;
      refreshAgents?: () => Promise<void>;
      toggleAutoRefresh?: () => void;
      collapseAllNodes?: () => void;
      expandAllNodes?: () => void;
      toggleHelp?: () => void;
    },
  ): Promise<boolean> {
    // Try each handler in order
    return (
      handleNavigationKeys(key, actions) ||
      handleTreeExpansionKeys(key, actions) ||
      (await handleActionKeys(key, actions)) ||
      handleDialogKeys(key, actions) ||
      handleToggleKeys(key, actions) ||
      handleBulkActionKeys(key, actions) ||
      (await handleSystemKeys(key, actions))
    );
  }
}
