/**
 * @module TUIStatusBarTest
 * @path tests/tui/utils/status_bar_test.ts
 * @description Verifies the core drawing logic for the terminal status bar, ensuring
 * responsive layout of partitioned items and correct color application.
 */

import { assertEquals, assertExists } from "@std/assert";
import { MessageType } from "@exaix/core";
import { SpinnerStyle, StatusIndicator } from "@exaix/tui";
import {
  addStatusLine,
  clearStatusMessage,
  createCountItem,
  createMultiLineStatusBarState,
  createPositionItem,
  createStatusBarState,
  createStatusItem,
  createTimestampItem,
  createViewTitleItem,
  type IStatusBarConfig,
  type IStatusBarItem,
  type IStatusBarState,
  renderMultiLineStatusBar,
  renderStatusBar,
  setLeftItems,
  setRightItems,
  setSpinner,
  setStatusMessage,
} from "../../../src/tui/helpers/status_bar.ts";
import { createSpinnerState, startSpinner } from "../../../src/tui/helpers/spinner.ts";
import { getTheme } from "../../../src/tui/helpers/colors.ts";
import { TUI_ICON_SUCCESS } from "../../../src/tui/helpers/constants.ts";

Deno.test("createStatusBarState: creates initial state", () => {
  const state = createStatusBarState();
  assertEquals(state.leftItems, []);
  assertEquals(state.rightItems, []);
  assertEquals(state.message, undefined);
  assertEquals(state.messageType, undefined);
  assertEquals(state.spinner, undefined);
});

Deno.test("renderStatusBar: renders basic status bar", () => {
  const state = createStatusBarState();
  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.length, 40);
});

Deno.test("renderStatusBar: renders with left items", () => {
  const state: IStatusBarState = {
    leftItems: [{ text: "Test", priority: 1 }],
    rightItems: [],
  };
  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.includes("Test"), true);
});

Deno.test("renderStatusBar: renders with right items", () => {
  const state: IStatusBarState = {
    leftItems: [],
    rightItems: [{ text: "Right", priority: 1 }],
  };
  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.includes("Right"), true);
});

Deno.test("renderStatusBar: renders with message", () => {
  const state: IStatusBarState = {
    leftItems: [],
    rightItems: [],
    message: "Status message",
    messageType: MessageType.INFO,
  };
  const config: IStatusBarConfig = {
    width: 60,
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.includes("Status message"), true);
});

Deno.test("renderStatusBar: renders message types", () => {
  const types: Array<MessageType> = Object.values(MessageType) as MessageType[];

  for (const type of types) {
    const state: IStatusBarState = {
      leftItems: [],
      rightItems: [],
      message: `${type} message`,
      messageType: type,
    };
    const config: IStatusBarConfig = {
      width: 60,
      useColors: true,
    };
    const result = renderStatusBar(state, config);
    assertExists(result);
  }
});

Deno.test("renderStatusBar: renders with spinner", () => {
  let spinner = createSpinnerState("Loading...");
  spinner = startSpinner(spinner);

  const state: IStatusBarState = {
    leftItems: [],
    rightItems: [],
    spinner,
  };
  const config: IStatusBarConfig = {
    width: 60,
    useColors: false,
    showSpinner: true,
    spinnerStyle: SpinnerStyle.DOTS,
  };
  const result = renderStatusBar(state, config);
  assertExists(result);
  assertEquals(result.includes("Loading"), true);
});

Deno.test("renderStatusBar: renders with colors", () => {
  const state: IStatusBarState = {
    leftItems: [{ text: "Test", color: "\x1b[32m", priority: 1 }],
    rightItems: [],
  };
  const config: IStatusBarConfig = {
    width: 40,
    useColors: true,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.includes("\x1b[7m"), true); // Inverted
  assertEquals(result.includes("\x1b[0m"), true); // Reset
});

Deno.test("renderStatusBar: renders with icon in item", () => {
  const state: IStatusBarState = {
    leftItems: [{ text: "Status", icon: "●", priority: 1 }],
    rightItems: [],
  };
  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.includes("●"), true);
  assertEquals(result.includes("Status"), true);
});

Deno.test("renderStatusBar: truncates long content", () => {
  const state: IStatusBarState = {
    leftItems: [{ text: "A".repeat(100), priority: 1 }],
    rightItems: [{ text: "B".repeat(100), priority: 1 }],
  };
  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.length, 40);
});

Deno.test("createViewTitleItem: creates title item", () => {
  const theme = getTheme(true);
  const item = createViewTitleItem("My View", theme);
  assertEquals(item.text, "My View");
  assertEquals(item.color, theme.textBold);
  assertEquals(item.priority, 100);
});

Deno.test("createCountItem: creates count item", () => {
  const theme = getTheme(true);
  const item = createCountItem(42, "items", theme);
  assertEquals(item.text, "42 items");
  assertEquals(item.color, theme.textDim);
  assertEquals(item.priority, 50);
});

Deno.test("createStatusItem: creates status items for all states", () => {
  const theme = getTheme(true);
  const statuses = [
    StatusIndicator.ACTIVE,
    StatusIndicator.PENDING,
    StatusIndicator.COMPLETED,
    StatusIndicator.FAILED,
  ] as const;

  for (const status of statuses) {
    const item = createStatusItem(status, undefined, theme);
    assertEquals(item.text, status);
    assertExists(item.icon);
    assertEquals(item.priority, 75);
  }
});

Deno.test("createStatusItem: accepts custom label", () => {
  const theme = getTheme(true);
  const item = createStatusItem(StatusIndicator.ACTIVE, "Running", theme);
  assertEquals(item.text, "Running");
  assertEquals(item.icon, "●");
});

Deno.test("createStatusItem: works without theme", () => {
  const item = createStatusItem(StatusIndicator.COMPLETED);
  assertEquals(item.text, StatusIndicator.COMPLETED);
  assertEquals(item.icon, TUI_ICON_SUCCESS);
  assertEquals(item.color, "");
});

Deno.test("createPositionItem: creates position indicator", () => {
  const theme = getTheme(true);
  const item = createPositionItem(5, 10, theme);
  assertEquals(item.text, "5/10");
  assertEquals(item.color, theme.textDim);
  assertEquals(item.priority, 25);
});

Deno.test("createTimestampItem: creates timestamp item", () => {
  const theme = getTheme(true);
  const date = new Date("2026-01-05T13:45:00");
  const item = createTimestampItem(date, theme);
  assertExists(item.text);
  assertEquals(item.color, theme.textDim);
  assertEquals(item.priority, 10);
});

Deno.test("setStatusMessage: sets message with type", () => {
  const state = createStatusBarState();
  const updated = setStatusMessage(state, "Test message", MessageType.WARNING);
  assertEquals(updated.message, "Test message");
  assertEquals(updated.messageType, MessageType.WARNING);
});

Deno.test("setStatusMessage: defaults to info type", () => {
  const state = createStatusBarState();
  const updated = setStatusMessage(state, "Info message");
  assertEquals(updated.message, "Info message");
  assertEquals(updated.messageType, MessageType.INFO);
});

Deno.test("clearStatusMessage: clears message", () => {
  let state = createStatusBarState();
  state = setStatusMessage(state, "Message", MessageType.ERROR);
  const cleared = clearStatusMessage(state);
  assertEquals(cleared.message, undefined);
  assertEquals(cleared.messageType, undefined);
});

Deno.test("setLeftItems: sets and sorts by priority", () => {
  const state = createStatusBarState();
  const items: IStatusBarItem[] = [
    { text: "Low", priority: 10 },
    { text: "High", priority: 100 },
    { text: "Medium", priority: 50 },
  ];
  const updated = setLeftItems(state, items);
  assertEquals(updated.leftItems[0].text, "High");
  assertEquals(updated.leftItems[1].text, "Medium");
  assertEquals(updated.leftItems[2].text, "Low");
});

Deno.test("setRightItems: sets and sorts by priority", () => {
  const state = createStatusBarState();
  const items: IStatusBarItem[] = [
    { text: "First", priority: 1 },
    { text: "Third", priority: 3 },
    { text: "Second", priority: 2 },
  ];
  const updated = setRightItems(state, items);
  assertEquals(updated.rightItems[0].text, "Third");
  assertEquals(updated.rightItems[1].text, "Second");
  assertEquals(updated.rightItems[2].text, "First");
});

Deno.test("setSpinner: sets spinner state", () => {
  const state = createStatusBarState();
  let spinner = createSpinnerState("Loading");
  spinner = startSpinner(spinner);
  const updated = setSpinner(state, spinner);
  assertExists(updated.spinner);
  assertEquals(updated.spinner.active, true);
});

Deno.test("setSpinner: clears spinner with undefined", () => {
  let state = createStatusBarState();
  const spinner = startSpinner(createSpinnerState("Loading"));
  state = setSpinner(state, spinner);
  const cleared = setSpinner(state, undefined);
  assertEquals(cleared.spinner, undefined);
});

// Multi-line status bar tests

Deno.test("createMultiLineStatusBarState: creates initial state", () => {
  const state = createMultiLineStatusBarState();
  assertEquals(state.leftItems, []);
  assertEquals(state.rightItems, []);
  assertEquals(state.lines, []);
  assertEquals(state.expanded, false);
});

Deno.test("addStatusLine: adds line to state", () => {
  let state = createMultiLineStatusBarState();
  state = addStatusLine(state, "Line 1");
  state = addStatusLine(state, "Line 2");
  assertEquals(state.lines.length, 2);
  assertEquals(state.lines[0], "Line 1");
  assertEquals(state.lines[1], "Line 2");
});

Deno.test("addStatusLine: respects maxLines limit", () => {
  let state = createMultiLineStatusBarState();
  for (let i = 0; i < 10; i++) {
    state = addStatusLine(state, `Line ${i}`, 5);
  }
  assertEquals(state.lines.length, 5);
  assertEquals(state.lines[0], "Line 5");
  assertEquals(state.lines[4], "Line 9");
});

Deno.test("renderMultiLineStatusBar: renders collapsed state", () => {
  const state = createMultiLineStatusBarState();
  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderMultiLineStatusBar(state, config);
  assertEquals(result.length, 1);
});

Deno.test("renderMultiLineStatusBar: renders expanded state", () => {
  let state = createMultiLineStatusBarState();
  state = addStatusLine(state, "Extra line 1");
  state = addStatusLine(state, "Extra line 2");
  state = { ...state, expanded: true };

  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderMultiLineStatusBar(state, config);
  assertEquals(result.length, 3); // Main bar + 2 extra lines
});

Deno.test("renderMultiLineStatusBar: renders with colors", () => {
  let state = createMultiLineStatusBarState();
  state = addStatusLine(state, "Colored line");
  state = { ...state, expanded: true };

  const config: IStatusBarConfig = {
    width: 40,
    useColors: true,
  };
  const result = renderMultiLineStatusBar(state, config);
  assertEquals(result.length, 2);
  // Check for ANSI codes
  assertEquals(result[0].includes("\x1b["), true);
});

Deno.test("renderMultiLineStatusBar: does not render lines when collapsed", () => {
  let state = createMultiLineStatusBarState();
  state = addStatusLine(state, "Hidden line");
  state = { ...state, expanded: false };

  const config: IStatusBarConfig = {
    width: 40,
    useColors: false,
  };
  const result = renderMultiLineStatusBar(state, config);
  assertEquals(result.length, 1);
  assertEquals(result[0].includes("Hidden line"), false);
});

Deno.test("setLeftItems: handles items without priority", () => {
  const state = createStatusBarState();
  const items: IStatusBarItem[] = [
    { text: "No priority" },
    { text: "Has priority", priority: 50 },
  ];
  const updated = setLeftItems(state, items);
  assertEquals(updated.leftItems[0].text, "Has priority");
  assertEquals(updated.leftItems[1].text, "No priority");
});

Deno.test("renderStatusBar: handles empty width gracefully", () => {
  const state: IStatusBarState = {
    leftItems: [{ text: "Text", priority: 1 }],
    rightItems: [],
  };
  const config: IStatusBarConfig = {
    width: 10, // Very narrow
    useColors: false,
  };
  const result = renderStatusBar(state, config);
  assertEquals(result.length, 10);
});
