/**
 * @module PaneManager
 * @path src/tui/dashboard/pane_manager.ts
 * @description Manager for TUI dashboard panes, handling splitting, closing, resizing, and focus switching logic.
 * @architectural-layer TUI
 * * @related-files [src/tui/tui_dashboard.ts, src/tui/dashboard/renderer.ts]
 */

import { MessageType, SplitDirection } from "../../shared/enums.ts";
import { TUI_LAYOUT_DEFAULT_HEIGHT, TUI_LAYOUT_FULL_WIDTH } from "../helpers/constants.ts";

import type { IPane, ITuiView } from "../tui_dashboard.ts";

/**
 * Split a pane in the specified direction
 */
export async function splitPane(
  panes: IPane[],
  activePaneId: string,
  views: ITuiView[],
  direction: SplitDirection,
  notify: (message: string, type?: string) => Promise<void>,
): Promise<{ panes: IPane[]; activePaneId: string }> {
  const activePane = panes.find((p) => p.id === activePaneId);
  if (!activePane) return { panes, activePaneId };

  const newId = `pane-${panes.length}`;
  if (direction === SplitDirection.VERTICAL) {
    // Split vertically: left-right
    const halfFlexWidth = activePane.flexWidth / 2;
    const halfWidth = Math.floor(activePane.width / 2);
    // Check for Deno global in test debug mode
    type PaneManagerGlobalWithDeno = typeof globalThis & { Deno?: { env: { get(k: string): string | undefined } } };
    const globalWithDenoPane = globalThis as PaneManagerGlobalWithDeno;
    if (
      typeof globalWithDenoPane.Deno !== "undefined" &&
      globalWithDenoPane.Deno?.env.get("EXA_TEST_LOG_SPLIT_DEBUG") === "1"
    ) {
      console.debug("[TUI][DEBUG] splitPane vertical BEFORE", activePane.id, "flexWidth=", activePane.flexWidth);
    }

    const newPane: IPane = {
      id: newId,
      view: views[1] || views[0],
      flexX: activePane.flexX + halfFlexWidth,
      flexY: activePane.flexY,
      flexWidth: halfFlexWidth,
      flexHeight: activePane.flexHeight,
      x: activePane.x + halfWidth,
      y: activePane.y,
      width: halfWidth,
      height: activePane.height,
      focused: false,
      maximized: false,
    };

    activePane.flexWidth = halfFlexWidth;
    activePane.width = halfWidth;
    // Check for Deno global in test debug mode (reuse type from above)
    const globalWithDenoPane2 = globalThis as PaneManagerGlobalWithDeno;
    if (
      typeof globalWithDenoPane2.Deno !== "undefined" &&
      globalWithDenoPane2.Deno?.env.get("EXA_TEST_LOG_SPLIT_DEBUG") === "1"
    ) {
      console.debug("[TUI][DEBUG] splitPane vertical AFTER", activePane.id, "flexWidth=", activePane.flexWidth);
    }
    panes.push(newPane);
  } else {
    // Split horizontally: top-bottom
    const halfFlexHeight = activePane.flexHeight / 2;
    const halfHeight = Math.floor(activePane.height / 2);

    const newPane: IPane = {
      id: newId,
      view: views[1] || views[0],
      flexX: activePane.flexX,
      flexY: activePane.flexY + halfFlexHeight,
      flexWidth: activePane.flexWidth,
      flexHeight: halfFlexHeight,
      x: activePane.x,
      y: activePane.y + halfHeight,
      width: activePane.width,
      height: halfHeight,
      focused: false,
      maximized: false,
    };

    activePane.flexHeight = halfFlexHeight;
    activePane.height = halfHeight;
    // Append the new bottom pane to the end so test indexing remains stable
    panes.push(newPane);
  }

  await notify(`IPane split ${direction}`, MessageType.INFO);
  return { panes, activePaneId };
}

/**
 * Close a pane and merge its space back into a neighbor
 */
export async function closePane(
  panes: IPane[],
  activePaneId: string,
  paneId: string,
  notify: (message: string, type?: string) => Promise<void>,
): Promise<{ panes: IPane[]; activePaneId: string }> {
  const index = panes.findIndex((p) => p.id === paneId);
  if (index === -1 || panes.length === 1) return { panes, activePaneId };

  const closingPane = panes[index];

  const leftSibling = findLeftSibling(panes, closingPane);
  const rightSibling = leftSibling ? undefined : findRightSibling(panes, closingPane);
  const topSibling = leftSibling || rightSibling ? undefined : findTopSibling(panes, closingPane);
  const bottomSibling = leftSibling || rightSibling || topSibling ? undefined : findBottomSibling(panes, closingPane);

  if (leftSibling) {
    leftSibling.flexWidth += closingPane.flexWidth;
  } else if (rightSibling) {
    rightSibling.flexX = closingPane.flexX;
    rightSibling.flexWidth += closingPane.flexWidth;
  } else if (topSibling) {
    topSibling.flexHeight += closingPane.flexHeight;
  } else if (bottomSibling) {
    bottomSibling.flexY = closingPane.flexY;
    bottomSibling.flexHeight += closingPane.flexHeight;
  }

  panes.splice(index, 1);
  let newActivePaneId = activePaneId;

  if (activePaneId === paneId) {
    newActivePaneId = panes[0].id;
    panes[0].focused = true;
  }

  await notify("IPane closed", MessageType.INFO);
  return { panes, activePaneId: newActivePaneId };
}

/**
 * Find the right sibling pane that shares the left edge with our right edge
 */
function findRightSibling(panes: IPane[], pane: IPane): IPane | undefined {
  return panes.find((p) =>
    p.id !== pane.id &&
    Math.abs(p.flexX - (pane.flexX + pane.flexWidth)) < 0.01 &&
    Math.abs(p.flexY - pane.flexY) < 0.01 &&
    Math.abs(p.flexHeight - pane.flexHeight) < 0.01
  );
}

/**
 * Find the left sibling pane that shares the right edge with our left edge
 */
function findLeftSibling(panes: IPane[], pane: IPane): IPane | undefined {
  return panes.find((p) =>
    p.id !== pane.id &&
    Math.abs((p.flexX + p.flexWidth) - pane.flexX) < 0.01 &&
    Math.abs(p.flexY - pane.flexY) < 0.01 &&
    Math.abs(p.flexHeight - pane.flexHeight) < 0.01
  );
}

/**
 * Find the bottom sibling pane that shares the top edge with our bottom edge
 */
function findBottomSibling(panes: IPane[], pane: IPane): IPane | undefined {
  return panes.find((p) =>
    p.id !== pane.id &&
    Math.abs(p.flexY - (pane.flexY + pane.flexHeight)) < 0.01 &&
    Math.abs(p.flexX - pane.flexX) < 0.01 &&
    Math.abs(p.flexWidth - pane.flexWidth) < 0.01
  );
}

/**
 * Find the top sibling pane that shares the bottom edge with our top edge
 */
function findTopSibling(panes: IPane[], pane: IPane): IPane | undefined {
  return panes.find((p) =>
    p.id !== pane.id &&
    Math.abs((p.flexY + p.flexHeight) - pane.flexY) < 0.01 &&
    Math.abs(p.flexX - pane.flexX) < 0.01 &&
    Math.abs(p.flexWidth - pane.flexWidth) < 0.01
  );
}

/**
 * Handle width resizing by adjusting flex values with sibling pane
 */
function handleWidthResize(panes: IPane[], pane: IPane, deltaFlexWidth: number, MIN_FLEX: number): void {
  const oldFlexWidth = pane.flexWidth;
  const newFlexWidth = Math.max(MIN_FLEX, Math.min(0.9, pane.flexWidth + deltaFlexWidth));
  const actualDelta = newFlexWidth - oldFlexWidth;

  if (actualDelta === 0) return;

  // Try right sibling first
  const rightSibling = findRightSibling(panes, pane);
  if (rightSibling && rightSibling.flexWidth - actualDelta >= MIN_FLEX) {
    pane.flexWidth = newFlexWidth;
    rightSibling.flexX += actualDelta;
    rightSibling.flexWidth -= actualDelta;
    return;
  }

  // Try left sibling as fallback
  const leftSibling = findLeftSibling(panes, pane);
  if (leftSibling && leftSibling.flexWidth - actualDelta >= MIN_FLEX) {
    pane.flexX -= actualDelta;
    pane.flexWidth = newFlexWidth;
    leftSibling.flexWidth -= actualDelta;
  }
}

/**
 * Handle height resizing by adjusting flex values with sibling pane
 */
function handleHeightResize(panes: IPane[], pane: IPane, deltaFlexHeight: number, MIN_FLEX: number): void {
  const oldFlexHeight = pane.flexHeight;
  const newFlexHeight = Math.max(MIN_FLEX, Math.min(0.9, pane.flexHeight + deltaFlexHeight));
  const actualDelta = newFlexHeight - oldFlexHeight;

  if (actualDelta === 0) return;

  // Try bottom sibling first
  const bottomSibling = findBottomSibling(panes, pane);
  if (bottomSibling && bottomSibling.flexHeight - actualDelta >= MIN_FLEX) {
    pane.flexHeight = newFlexHeight;
    bottomSibling.flexY += actualDelta;
    bottomSibling.flexHeight -= actualDelta;
    return;
  }

  // Try top sibling as fallback
  const topSibling = findTopSibling(panes, pane);
  if (topSibling && topSibling.flexHeight - actualDelta >= MIN_FLEX) {
    pane.flexY -= actualDelta;
    pane.flexHeight = newFlexHeight;
    topSibling.flexHeight -= actualDelta;
  }
}

/**
 * Resize a pane by adjusting flex values and its neighbors
 */
export function resizePane(
  panes: IPane[],
  paneId: string,
  deltaFlexWidth: number,
  deltaFlexHeight: number,
): void {
  const pane = panes.find((p) => p.id === paneId);
  if (!pane || pane.maximized) return;

  const MIN_FLEX = 0.1;

  if (deltaFlexWidth !== 0) {
    handleWidthResize(panes, pane, deltaFlexWidth, MIN_FLEX);
  }

  if (deltaFlexHeight !== 0) {
    handleHeightResize(panes, pane, deltaFlexHeight, MIN_FLEX);
  }
}

/**
 * Switch focus to a pane
 */
export function switchPane(
  panes: IPane[],
  paneId: string,
): string {
  const pane = panes.find((p) => p.id === paneId);
  if (pane) {
    panes.forEach((p) => p.focused = false);
    pane.focused = true;
    return paneId;
  }
  return "";
}

/**
 * Maximize or restore a pane
 */
export function maximizePane(
  panes: IPane[],
  paneId: string,
  notify: (message: string, type?: string) => Promise<void>,
): void {
  const pane = panes.find((p) => p.id === paneId);
  if (!pane) return;

  if (pane.maximized) {
    // Restore
    if (pane.previousBounds) {
      pane.flexX = pane.previousBounds.flexX;
      pane.flexY = pane.previousBounds.flexY;
      pane.flexWidth = pane.previousBounds.flexWidth;
      pane.flexHeight = pane.previousBounds.flexHeight;
      pane.x = pane.previousBounds.x;
      pane.y = pane.previousBounds.y;
      pane.width = pane.previousBounds.width;
      pane.height = pane.previousBounds.height;
    }
    pane.maximized = false;
    notify("IPane restored", MessageType.INFO);
  } else {
    // Maximize
    pane.previousBounds = {
      flexX: pane.flexX,
      flexY: pane.flexY,
      flexWidth: pane.flexWidth,
      flexHeight: pane.flexHeight,
      x: pane.x,
      y: pane.y,
      width: pane.width,
      height: pane.height,
    };
    pane.flexX = 0;
    pane.flexY = 0;
    pane.flexWidth = 1.0;
    pane.flexHeight = 1.0;
    pane.x = 0;
    pane.y = 0;
    pane.width = TUI_LAYOUT_FULL_WIDTH;
    pane.height = TUI_LAYOUT_DEFAULT_HEIGHT;
    pane.maximized = true;
    notify("IPane maximized", MessageType.INFO);
  }
}
