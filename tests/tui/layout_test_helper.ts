/**
 * @module TUILayoutTestHelper
 * @path tests/tui/layout_test_helper.ts
 * @description Provides helper functions for simulating terminal layout transitions and
 * verifying panel coordinates in complex multi-view dashboards.
 */

import { createLayoutManager, type ILayoutPane } from "../../src/tui/helpers/layout_manager.ts";

export function setupLayoutManager(width = 80, height = 24): ReturnType<typeof createLayoutManager> {
  return createLayoutManager(width, height);
}

export function createTestPane(overrides: Partial<ILayoutPane> = {}): ILayoutPane {
  return {
    id: "main",
    viewName: "PortalManagerView",
    x: 0,
    y: 0,
    width: 80,
    height: 24,
    focused: true,
    ...overrides,
  };
}

export function createPanes(count: number, width = 40, height = 24): ILayoutPane[] {
  const panes: ILayoutPane[] = [];
  const views = ["PortalManagerView", "MonitorView", "PlanReviewerView", "DaemonControlView"];

  for (let i = 0; i < count; i++) {
    panes.push({
      id: i === 0 ? "left" : "right",
      viewName: views[i % views.length],
      x: i * width,
      y: 0,
      width: width,
      height: height,
      focused: i === 0,
    });
  }
  return panes;
}
