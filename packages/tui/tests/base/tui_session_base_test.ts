/**
 * @module TuiSessionBaseTest
 * @path packages/tui/tests/base/tui_session_base_test.ts
 * @description Verifies package-owned TUI session utilities, refresh configuration, and scrolling helpers.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  calculateScrollOffset,
  clampScrollOffset,
  createRefreshConfig,
  createViewState,
  TuiSessionBase,
} from "@exaix/tui/base/tui_session_base.ts";

class TestSession extends TuiSessionBase {
  public refreshCount = 0;

  constructor(useColors = false) {
    super(useColors);
  }

  override getKeyBindings() {
    return [];
  }

  override getViewName(): string {
    return "Test View";
  }

  setupRefresh(): void {
    this.configureRefresh(() => {
      this.refreshCount++;
      return Promise.resolve();
    });
  }

  public testStartLoading(message: string): void {
    this.startLoading(message);
  }

  public testStopLoading(): void {
    this.stopLoading();
  }

  public testAdvanceSpinner(): void {
    this.advanceSpinner();
  }

  public testPerformWithLoading<T>(fn: () => Promise<T>): Promise<T | null> {
    return this.performWithLoading(fn);
  }

  public testPerformAction(fn: () => Promise<unknown>): Promise<void> {
    return this.performAction(fn);
  }
}

Deno.test("createViewState: creates default state", () => {
  const state = createViewState();
  assertEquals(state.selectedIndex, 0);
  assertEquals(state.itemCount, 0);
  assertEquals(state.scrollOffset, 0);
  assertEquals(state.isLoading, false);
  assertEquals(state.needsRefresh, true);
  assertEquals(state.filterText, "");
  assertEquals(state.showHelp, false);
  assertEquals(state.activeDialog, null);
});

Deno.test("createViewState: accepts overrides", () => {
  const state = createViewState({ selectedIndex: 5, itemCount: 10, filterText: "test" });
  assertEquals(state.selectedIndex, 5);
  assertEquals(state.itemCount, 10);
  assertEquals(state.filterText, "test");
  assertEquals(state.isLoading, false);
});

Deno.test("createRefreshConfig: creates config", () => {
  const config = createRefreshConfig(() => Promise.resolve(), 5000);
  assertEquals(config.autoRefreshInterval, 5000);
  assertEquals(config.enabled, true);
});

Deno.test("createRefreshConfig: disabled when interval is 0", () => {
  const config = createRefreshConfig(() => Promise.resolve(), 0);
  assertEquals(config.enabled, false);
});

Deno.test("TuiSessionBase: getSelectedIndex returns initial 0", () => {
  const session = new TestSession();
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("TuiSessionBase: setSelectedIndex updates index", () => {
  const session = new TestSession();
  session.setSelectedIndex(5, 10);
  assertEquals(session.getSelectedIndex(), 5);
});

Deno.test("TuiSessionBase: setSelectedIndex clamps negative to 0", () => {
  const session = new TestSession();
  session.setSelectedIndex(-1, 10);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("TuiSessionBase: setSelectedIndex clamps over length to 0", () => {
  const session = new TestSession();
  session.setSelectedIndex(15, 10);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("TuiSessionBase: handleNavigationKey down", () => {
  const session = new TestSession();
  const handled = session.handleNavigationKey("down", 10);
  assertEquals(handled, true);
  assertEquals(session.getSelectedIndex(), 1);
});

Deno.test("TuiSessionBase: handleNavigationKey up", () => {
  const session = new TestSession();
  session.setSelectedIndex(5, 10);
  session.handleNavigationKey("up", 10);
  assertEquals(session.getSelectedIndex(), 4);
});

Deno.test("TuiSessionBase: handleNavigationKey home", () => {
  const session = new TestSession();
  session.setSelectedIndex(5, 10);
  session.handleNavigationKey("home", 10);
  assertEquals(session.getSelectedIndex(), 0);
});

Deno.test("TuiSessionBase: handleNavigationKey end", () => {
  const session = new TestSession();
  session.handleNavigationKey("end", 10);
  assertEquals(session.getSelectedIndex(), 9);
});

Deno.test("TuiSessionBase: handleNavigationKey returns false for unknown", () => {
  const session = new TestSession();
  assertEquals(session.handleNavigationKey("x", 10), false);
});

Deno.test("TuiSessionBase: handleNavigationKey returns false for empty list", () => {
  const session = new TestSession();
  assertEquals(session.handleNavigationKey("down", 0), false);
});

Deno.test("TuiSessionBase: clampSelection adjusts when over length", () => {
  const session = new TestSession();
  session.setSelectedIndex(5, 10);
  session.clampSelection(3);
  assertEquals(session.getSelectedIndex(), 2);
});

Deno.test("TuiSessionBase: getStatusMessage returns empty initially", () => {
  const session = new TestSession();
  assertEquals(session.getStatusMessage(), "");
});

Deno.test("TuiSessionBase: setStatus sets message", () => {
  const session = new TestSession();
  session.setStatus("Test message");
  assertEquals(session.getStatusMessage(), "Test message");
});

Deno.test("TuiSessionBase: clearStatus clears message", () => {
  const session = new TestSession();
  session.setStatus("Test message");
  session.clearStatus();
  assertEquals(session.getStatusMessage(), "");
});

Deno.test("TuiSessionBase: isSpinnerActive false initially", () => {
  const session = new TestSession();
  assertEquals(session.isSpinnerActive(), false);
});

Deno.test("TuiSessionBase: startLoading activates spinner", () => {
  const session = new TestSession();
  session.testStartLoading("Loading...");
  assertEquals(session.isSpinnerActive(), true);
});

Deno.test("TuiSessionBase: stopLoading deactivates spinner", () => {
  const session = new TestSession();
  session.testStartLoading("Loading...");
  session.testStopLoading();
  assertEquals(session.isSpinnerActive(), false);
});

Deno.test("TuiSessionBase: getSpinnerState returns state", () => {
  const session = new TestSession();
  const state = session.getSpinnerState();
  assertExists(state);
  assertEquals(state.active, false);
});

Deno.test("TuiSessionBase: getTheme returns theme", () => {
  const session = new TestSession(true);
  const theme = session.getTheme();
  assertExists(theme);
  assertExists(theme.reset);
});

Deno.test("TuiSessionBase: updateColorMode changes theme", () => {
  const session = new TestSession(true);
  session.getTheme();
  session.updateColorMode(false);
  const noColorTheme = session.getTheme();
  assertEquals(noColorTheme.reset, "");
});

Deno.test("TuiSessionBase: getViewState returns state", () => {
  const session = new TestSession();
  const state = session.getViewState();
  assertExists(state);
  assertEquals(state.selectedIndex, 0);
});

Deno.test("TuiSessionBase: toggleHelp toggles state", () => {
  const session = new TestSession();
  assertEquals(session.isHelpVisible(), false);
  session.toggleHelp();
  assertEquals(session.isHelpVisible(), true);
  session.toggleHelp();
  assertEquals(session.isHelpVisible(), false);
});

Deno.test("TuiSessionBase: setFilter/getFilter work", () => {
  const session = new TestSession();
  assertEquals(session.getFilter(), "");
  session.setFilter("test");
  assertEquals(session.getFilter(), "test");
});

Deno.test("TuiSessionBase: dialog methods work", () => {
  const session = new TestSession();
  assertEquals(session.hasDialogOpen(), false);
  assertEquals(session.getActiveDialogId(), null);
  session.setActiveDialogId("confirm");
  assertEquals(session.hasDialogOpen(), true);
  assertEquals(session.getActiveDialogId(), "confirm");
  session.setActiveDialogId(null);
  assertEquals(session.hasDialogOpen(), false);
});

Deno.test("TuiSessionBase: refresh calls onRefresh", async () => {
  const session = new TestSession();
  session.setupRefresh();
  assertEquals(session.refreshCount, 0);
  await session.refresh();
  assertEquals(session.refreshCount, 1);
});

Deno.test("TuiSessionBase: markNeedsRefresh sets flag", () => {
  const session = new TestSession();
  const state = session.getViewState();
  state.needsRefresh = false;
  session.markNeedsRefresh();
  assertEquals(session.getViewState().needsRefresh, true);
});

Deno.test("TuiSessionBase: performWithLoading returns result", async () => {
  const session = new TestSession();
  const result = await session.testPerformWithLoading(() => Promise.resolve("success"));
  assertEquals(result, "success");
});

Deno.test("TuiSessionBase: performWithLoading handles error", async () => {
  const session = new TestSession();
  const result = await session.testPerformWithLoading(() => Promise.reject(new Error("Test error")));
  assertEquals(result, null);
});

Deno.test("TuiSessionBase: performAction clears status on success", async () => {
  const session = new TestSession();
  session.setStatus("Previous message");
  await session.testPerformAction(async () => {});
  assertEquals(session.getStatusMessage(), "");
});

Deno.test("TuiSessionBase: performAction sets error on failure", async () => {
  const session = new TestSession();
  await session.testPerformAction(() => Promise.reject(new Error("Test error")));
  assertEquals(session.getStatusMessage().includes("Test error"), true);
});

Deno.test("TuiSessionBase: getViewName returns name", () => {
  const session = new TestSession();
  assertEquals(session.getViewName(), "Test View");
});

Deno.test("TuiSessionBase: getKeyBindings returns array", () => {
  const session = new TestSession();
  assertEquals(Array.isArray(session.getKeyBindings()), true);
});

Deno.test("TuiSessionBase: dispose can be called", () => {
  const session = new TestSession();
  session.dispose();
});

Deno.test("calculateScrollOffset: returns 0 when items fit", () => {
  assertEquals(calculateScrollOffset(5, 0, 20, 10), 0);
});

Deno.test("calculateScrollOffset: scrolls up when above visible", () => {
  assertEquals(calculateScrollOffset(2, 5, 10, 20), 2);
});

Deno.test("calculateScrollOffset: scrolls down when below visible", () => {
  assertEquals(calculateScrollOffset(15, 0, 10, 20), 6);
});

Deno.test("calculateScrollOffset: keeps visible items in view", () => {
  assertEquals(calculateScrollOffset(5, 3, 10, 20), 3);
});

Deno.test("clampScrollOffset: clamps to 0", () => {
  assertEquals(clampScrollOffset(-5, 10, 20), 0);
});

Deno.test("clampScrollOffset: clamps to max", () => {
  assertEquals(clampScrollOffset(50, 10, 20), 10);
});
