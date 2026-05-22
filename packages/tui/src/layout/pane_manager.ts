/**
 * @module PaneManager
 * @path packages/tui/src/layout/pane_manager.ts
 * @description Package-owned TUI pane management helpers for splitting, resizing, focusing, and maximizing panes.
 * @architectural-layer TUI Layout
 * @related-files ["packages/tui/src/layout/manager.ts", "packages/tui/src/helpers/constants.ts"]
 */

import { MessageType } from "@exaix/core";
import { SplitDirection } from "../types/enums.ts";
import { TUI_LAYOUT_DEFAULT_HEIGHT, TUI_LAYOUT_FULL_WIDTH } from "@exaix/tui/helpers/constants.ts";

export interface ITuiViewLike {
  name: string;
}

export interface IPaneBounds {
  flexX: number;
  flexY: number;
  flexWidth: number;
  flexHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IPaneLike {
  id: string;
  view: ITuiViewLike;
  flexX: number;
  flexY: number;
  flexWidth: number;
  flexHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
  maximized?: boolean;
  previousBounds?: IPaneBounds;
}

export type TPaneNotification = (message: string, type?: string) => Promise<void>;

function isDebugEnvEnabled(name: string): boolean {
  try {
    return globalThis.Deno?.env.get(name) === "1";
  } catch {
    return false;
  }
}

export async function splitPane(
  panes: IPaneLike[],
  activePaneId: string,
  views: ITuiViewLike[],
  direction: SplitDirection,
  notify: TPaneNotification,
): Promise<{ panes: IPaneLike[]; activePaneId: string }> {
  const activePane = panes.find((pane) => pane.id === activePaneId);
  if (!activePane) return { panes, activePaneId };

  const newId = `pane-${panes.length}`;
  if (direction === SplitDirection.VERTICAL) {
    const halfFlexWidth = activePane.flexWidth / 2;
    const halfWidth = Math.floor(activePane.width / 2);
    if (isDebugEnvEnabled("EXA_TEST_LOG_SPLIT_DEBUG")) {
      console.debug("[TUI][DEBUG] splitPane vertical BEFORE", activePane.id, "flexWidth=", activePane.flexWidth);
    }

    const newPane: IPaneLike = {
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
    if (isDebugEnvEnabled("EXA_TEST_LOG_SPLIT_DEBUG")) {
      console.debug("[TUI][DEBUG] splitPane vertical AFTER", activePane.id, "flexWidth=", activePane.flexWidth);
    }
    panes.push(newPane);
  } else {
    const halfFlexHeight = activePane.flexHeight / 2;
    const halfHeight = Math.floor(activePane.height / 2);

    const newPane: IPaneLike = {
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
    panes.push(newPane);
  }

  await notify(`IPane split ${direction}`, MessageType.INFO);
  return { panes, activePaneId };
}

export async function closePane(
  panes: IPaneLike[],
  activePaneId: string,
  paneId: string,
  notify: TPaneNotification,
): Promise<{ panes: IPaneLike[]; activePaneId: string }> {
  const index = panes.findIndex((pane) => pane.id === paneId);
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
  let nextActivePaneId = activePaneId;
  if (activePaneId === paneId) {
    nextActivePaneId = panes[0].id;
    panes[0].focused = true;
  }

  await notify("IPane closed", MessageType.INFO);
  return { panes, activePaneId: nextActivePaneId };
}

export function resizePane(
  panes: IPaneLike[],
  paneId: string,
  deltaFlexWidth: number,
  deltaFlexHeight: number,
): void {
  const pane = panes.find((candidate) => candidate.id === paneId);
  if (!pane || pane.maximized) return;

  const minFlex = 0.1;
  if (deltaFlexWidth !== 0) {
    handleWidthResize(panes, pane, deltaFlexWidth, minFlex);
  }
  if (deltaFlexHeight !== 0) {
    handleHeightResize(panes, pane, deltaFlexHeight, minFlex);
  }
}

export function switchPane(panes: IPaneLike[], paneId: string): string {
  const pane = panes.find((candidate) => candidate.id === paneId);
  if (!pane) return "";

  panes.forEach((candidate) => candidate.focused = false);
  pane.focused = true;
  return paneId;
}

export function maximizePane(
  panes: IPaneLike[],
  paneId: string,
  notify: TPaneNotification,
): void {
  const pane = panes.find((candidate) => candidate.id === paneId);
  if (!pane) return;

  if (pane.maximized) {
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
    void notify("IPane restored", MessageType.INFO);
    return;
  }

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
  pane.flexWidth = 1;
  pane.flexHeight = 1;
  pane.x = 0;
  pane.y = 0;
  pane.width = TUI_LAYOUT_FULL_WIDTH;
  pane.height = TUI_LAYOUT_DEFAULT_HEIGHT;
  pane.maximized = true;
  void notify("IPane maximized", MessageType.INFO);
}

function findRightSibling(panes: IPaneLike[], pane: IPaneLike): IPaneLike | undefined {
  return panes.find((candidate) =>
    candidate.id !== pane.id &&
    Math.abs(candidate.flexX - (pane.flexX + pane.flexWidth)) < 0.01 &&
    Math.abs(candidate.flexY - pane.flexY) < 0.01 &&
    Math.abs(candidate.flexHeight - pane.flexHeight) < 0.01
  );
}

function findLeftSibling(panes: IPaneLike[], pane: IPaneLike): IPaneLike | undefined {
  return panes.find((candidate) =>
    candidate.id !== pane.id &&
    Math.abs((candidate.flexX + candidate.flexWidth) - pane.flexX) < 0.01 &&
    Math.abs(candidate.flexY - pane.flexY) < 0.01 &&
    Math.abs(candidate.flexHeight - pane.flexHeight) < 0.01
  );
}

function findBottomSibling(panes: IPaneLike[], pane: IPaneLike): IPaneLike | undefined {
  return panes.find((candidate) =>
    candidate.id !== pane.id &&
    Math.abs(candidate.flexY - (pane.flexY + pane.flexHeight)) < 0.01 &&
    Math.abs(candidate.flexX - pane.flexX) < 0.01 &&
    Math.abs(candidate.flexWidth - pane.flexWidth) < 0.01
  );
}

function findTopSibling(panes: IPaneLike[], pane: IPaneLike): IPaneLike | undefined {
  return panes.find((candidate) =>
    candidate.id !== pane.id &&
    Math.abs((candidate.flexY + candidate.flexHeight) - pane.flexY) < 0.01 &&
    Math.abs(candidate.flexX - pane.flexX) < 0.01 &&
    Math.abs(candidate.flexWidth - pane.flexWidth) < 0.01
  );
}

function handleWidthResize(panes: IPaneLike[], pane: IPaneLike, deltaFlexWidth: number, minFlex: number): void {
  const oldFlexWidth = pane.flexWidth;
  const newFlexWidth = Math.max(minFlex, Math.min(0.9, pane.flexWidth + deltaFlexWidth));
  const actualDelta = newFlexWidth - oldFlexWidth;
  if (actualDelta === 0) return;

  const rightSibling = findRightSibling(panes, pane);
  if (rightSibling && rightSibling.flexWidth - actualDelta >= minFlex) {
    pane.flexWidth = newFlexWidth;
    rightSibling.flexX += actualDelta;
    rightSibling.flexWidth -= actualDelta;
    return;
  }

  const leftSibling = findLeftSibling(panes, pane);
  if (leftSibling && leftSibling.flexWidth - actualDelta >= minFlex) {
    pane.flexX -= actualDelta;
    pane.flexWidth = newFlexWidth;
    leftSibling.flexWidth -= actualDelta;
  }
}

function handleHeightResize(panes: IPaneLike[], pane: IPaneLike, deltaFlexHeight: number, minFlex: number): void {
  const oldFlexHeight = pane.flexHeight;
  const newFlexHeight = Math.max(minFlex, Math.min(0.9, pane.flexHeight + deltaFlexHeight));
  const actualDelta = newFlexHeight - oldFlexHeight;
  if (actualDelta === 0) return;

  const bottomSibling = findBottomSibling(panes, pane);
  if (bottomSibling && bottomSibling.flexHeight - actualDelta >= minFlex) {
    pane.flexHeight = newFlexHeight;
    bottomSibling.flexY += actualDelta;
    bottomSibling.flexHeight -= actualDelta;
    return;
  }

  const topSibling = findTopSibling(panes, pane);
  if (topSibling && topSibling.flexHeight - actualDelta >= minFlex) {
    pane.flexY -= actualDelta;
    pane.flexHeight = newFlexHeight;
    topSibling.flexHeight -= actualDelta;
  }
}
