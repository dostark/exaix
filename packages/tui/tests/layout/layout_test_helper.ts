/**
 * @module TUILayoutTestHelper
 * @path packages/tui/tests/layout/layout_test_helper.ts
 * @description Provides helper functions for simulating terminal layout transitions and
 * verifying panel coordinates in complex multi-view dashboards.
 */

import { createLayoutManager, type ILayoutPane } from "@exaix/tui/layout/manager.ts";
import type { ITuiLayoutPersistencePane } from "@exaix/tui/layout/persistence.ts";

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

export function makePersistencePane(
  id: string,
  viewName: string,
  overrides: Partial<ITuiLayoutPersistencePane> = {},
): ITuiLayoutPersistencePane {
  return {
    id,
    view: { name: viewName },
    flexX: 0,
    flexY: 0,
    flexWidth: 1,
    flexHeight: 1,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    focused: true,
    maximized: false,
    ...overrides,
  };
}
