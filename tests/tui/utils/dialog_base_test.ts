/**
 * @module TUIDialogBaseTest
 * @path tests/tui/utils/dialog_base_test.ts
 * @description Verifies the core drawing logic for TUI dialog boxes, ensuring correct
 * rendering of borders, titles, and dynamic layouts within the terminal grid.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { DialogStatus, type SkillStatus as _SkillStatus } from "../../../src/shared/enums.ts";
import {
  BOX,
  ConfirmDialog,
  InputDialog,
  renderBoxBottom,
  renderBoxLine,
  renderBoxLineCentered,
  renderBoxTop,
  renderButton,
  SelectDialog,
  wrapToWidth,
} from "../../../src/tui/helpers/dialog_base.ts";
import { getTheme } from "../../../src/tui/helpers/colors.ts";
import { createMockDialogRenderOptions } from "../helpers.ts";
import { KEYS } from "../../../src/tui/helpers/keyboard.ts";

// ===== Box Characters Tests =====

Deno.test("BOX: has all required characters", () => {
  assertEquals(BOX.topLeft, "┌");
  assertEquals(BOX.topRight, "┐");
  assertEquals(BOX.bottomLeft, "└");
  assertEquals(BOX.bottomRight, "┘");
  assertEquals(BOX.horizontal, "─");
  assertEquals(BOX.vertical, "│");
});

// ===== Box Rendering Tests =====

Deno.test("renderBoxTop: renders with title", () => {
  const theme = getTheme(false);
  const result = renderBoxTop(40, " Title ", theme);
  assertStringIncludes(result, "┌");
  assertStringIncludes(result, "Title");
  assertStringIncludes(result, "┐");
});

Deno.test("renderBoxBottom: renders bottom border", () => {
  const theme = getTheme(false);
  const result = renderBoxBottom(40, theme);
  assertStringIncludes(result, "└");
  assertStringIncludes(result, "┘");
});

Deno.test("renderBoxLine: renders line with borders", () => {
  const theme = getTheme(false);
  const result = renderBoxLine("Content", 40, theme);
  assertStringIncludes(result, "│");
  assertStringIncludes(result, "Content");
});

Deno.test("renderBoxLineCentered: centers content", () => {
  const theme = getTheme(false);
  const result = renderBoxLineCentered("X", 10, theme);
  assertStringIncludes(result, "│");
  assertStringIncludes(result, "X");
  // Check it's centered (at least not at start)
  const xIndex = result.indexOf("X");
  assertEquals(xIndex > 2, true);
});

Deno.test("renderButton: renders focused button", () => {
  const theme = getTheme(false);
  const result = renderButton("OK", true, false, theme);
  assertStringIncludes(result, "[OK]");
});

Deno.test("renderButton: renders unfocused button", () => {
  const theme = getTheme(false);
  const result = renderButton("OK", false, false, theme);
  assertStringIncludes(result, " OK ");
});

// ===== Wrap Text Tests =====

Deno.test("wrapToWidth: wraps long text", () => {
  const lines = wrapToWidth("This is a long line that needs wrapping", 15);
  assertEquals(lines.length > 1, true);
  for (const line of lines) {
    assertEquals(line.length <= 15, true);
  }
});

Deno.test("wrapToWidth: preserves short text", () => {
  const lines = wrapToWidth("Short", 50);
  assertEquals(lines.length, 1);
  assertEquals(lines[0], "Short");
});

// ===== Confirm Dialog Tests =====

Deno.test("ConfirmDialog: creates with options", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  assertEquals(dialog.isActive(), true);
  assertEquals(dialog.getState(), DialogStatus.ACTIVE);
});

Deno.test("ConfirmDialog: getFocusableElements returns buttons", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  const elements = dialog.getFocusableElements();
  assertEquals(elements.length, 2);
  assertEquals(elements[0], "confirm");
  assertEquals(elements[1], "cancel");
});

Deno.test("ConfirmDialog: y key confirms", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  dialog.handleKey(KEYS.Y);
  assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
  assertEquals(dialog.getResult().type, DialogStatus.CONFIRMED);
});

Deno.test("ConfirmDialog: n key cancels", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  dialog.handleKey(KEYS.N);
  assertEquals(dialog.getState(), DialogStatus.CANCELLED);
  assertEquals(dialog.getResult().type, DialogStatus.CANCELLED);
});

Deno.test("ConfirmDialog: escape cancels", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  dialog.handleKey(KEYS.ESCAPE);
  assertEquals(dialog.getState(), DialogStatus.CANCELLED);
});

Deno.test("ConfirmDialog: tab moves focus", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  assertEquals(dialog.getFocusIndex(), 0);
  dialog.handleKey(KEYS.TAB);
  assertEquals(dialog.getFocusIndex(), 1);
  dialog.handleKey(KEYS.TAB);
  assertEquals(dialog.getFocusIndex(), 0);
});

Deno.test("ConfirmDialog: enter on confirm button confirms", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  dialog.handleKey(KEYS.ENTER);
  assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
});

Deno.test("ConfirmDialog: enter on cancel button cancels", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  dialog.handleKey(KEYS.TAB); // Move to cancel
  dialog.handleKey(KEYS.ENTER);
  assertEquals(dialog.getState(), DialogStatus.CANCELLED);
});

Deno.test("ConfirmDialog: renders correctly", () => {
  const dialog = new ConfirmDialog({
    title: "Confirm",
    message: "Are you sure?",
  });

  const lines = dialog.render(createMockDialogRenderOptions());
  assertEquals(lines.length > 0, true);

  const text = lines.join("\n");
  assertStringIncludes(text, "Confirm");
  assertStringIncludes(text, "Are you sure?");
  assertStringIncludes(text, "Yes");
  assertStringIncludes(text, "No");
});

// ===== Input Dialog Tests =====

Deno.test("InputDialog: creates with options", () => {
  const dialog = new InputDialog({
    title: "Enter Name",
    label: "Name",
  });

  assertEquals(dialog.isActive(), true);
  assertEquals(dialog.getValue(), "");
});

Deno.test("InputDialog: has default value", () => {
  const dialog = new InputDialog({
    title: "Enter Name",
    label: "Name",
    defaultValue: "Default",
  });

  assertEquals(dialog.getValue(), "Default");
});

Deno.test("InputDialog: getFocusableElements returns elements", () => {
  const dialog = new InputDialog({
    title: "Input",
    label: "Value",
  });

  const elements = dialog.getFocusableElements();
  assertEquals(elements.length, 3);
  assertEquals(elements[0], "input");
  assertEquals(elements[1], "confirm");
  assertEquals(elements[2], "cancel");
});

Deno.test("InputDialog: enter on input starts editing", () => {
  const dialog = new InputDialog({
    title: "Input",
    label: "Value",
  });

  assertEquals(dialog.isEditing(), false);
  dialog.handleKey(KEYS.ENTER);
  assertEquals(dialog.isEditing(), true);
});

Deno.test("InputDialog: escape exits editing", () => {
  const dialog = new InputDialog({
    title: "Input",
    label: "Value",
  });

  dialog.handleKey(KEYS.ENTER); // Start editing
  assertEquals(dialog.isEditing(), true);
  dialog.handleKey(KEYS.ESCAPE);
  assertEquals(dialog.isEditing(), false);
});

Deno.test("InputDialog: typing adds characters", () => {
  const dialog = new InputDialog({
    title: "Input",
    label: "Value",
  });

  dialog.handleKey(KEYS.ENTER); // Start editing
  dialog.handleKey(KEYS.A);
  dialog.handleKey(KEYS.B);
  dialog.handleKey(KEYS.C);

  assertEquals(dialog.getValue(), "abc");
});

Deno.test("InputDialog: backspace removes characters", () => {
  const dialog = new InputDialog({
    title: "Input",
    label: "Value",
    defaultValue: "abc",
  });

  dialog.handleKey(KEYS.ENTER); // Start editing
  dialog.handleKey(KEYS.BACKSPACE);
  assertEquals(dialog.getValue(), "ab");
});

Deno.test("InputDialog: renders correctly", () => {
  const dialog = new InputDialog({
    title: "Enter Value",
    label: "Name",
    placeholder: "Type here",
  });

  const lines = dialog.render(createMockDialogRenderOptions());
  const text = lines.join("\n");
  assertStringIncludes(text, "Enter Value");
  assertStringIncludes(text, "Name");
  assertStringIncludes(text, "OK");
  assertStringIncludes(text, "Cancel");
});

// ===== Select Dialog Tests =====

Deno.test("SelectDialog: creates with options", () => {
  const dialog = new SelectDialog({
    title: "Choose",
    options: [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ],
  });

  assertEquals(dialog.isActive(), true);
  assertEquals(dialog.getSelectedIndex(), 0);
});

Deno.test("SelectDialog: down key moves selection", () => {
  const dialog = new SelectDialog({
    title: "Choose",
    options: [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ],
  });

  assertEquals(dialog.getSelectedIndex(), 0);
  dialog.handleKey(KEYS.DOWN);
  assertEquals(dialog.getSelectedIndex(), 1);
});

Deno.test("SelectDialog: up key moves selection", () => {
  const dialog = new SelectDialog({
    title: "Choose",
    options: [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ],
    selectedIndex: 1,
  });

  dialog.handleKey(KEYS.UP);
  assertEquals(dialog.getSelectedIndex(), 0);
});

Deno.test("SelectDialog: enter confirms selection", () => {
  const dialog = new SelectDialog({
    title: "Choose",
    options: [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ],
  });

  dialog.handleKey(KEYS.ENTER);
  assertEquals(dialog.getState(), DialogStatus.CONFIRMED);
  const result = dialog.getResult();
  assertEquals(result.type, DialogStatus.CONFIRMED);
  if (result.type === DialogStatus.CONFIRMED) {
    assertEquals(result.value, "a");
  }
});

Deno.test("SelectDialog: escape cancels", () => {
  const dialog = new SelectDialog({
    title: "Choose",
    options: [
      { value: "a", label: "Option A" },
    ],
  });

  dialog.handleKey(KEYS.ESCAPE);
  assertEquals(dialog.getState(), DialogStatus.CANCELLED);
});

Deno.test("SelectDialog: renders options", () => {
  const dialog = new SelectDialog({
    title: "Choose Option",
    options: [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ],
  });

  const lines = dialog.render(createMockDialogRenderOptions());
  const text = lines.join("\n");
  assertStringIncludes(text, "Choose Option");
  assertStringIncludes(text, "Option A");
  assertStringIncludes(text, "Option B");
});
