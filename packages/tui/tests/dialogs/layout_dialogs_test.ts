/**
 * @module LayoutDialogsTest
 * @path packages/tui/tests/dialogs/layout_dialogs_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies package-owned TUI layout dialogs and keyboard-driven state transitions.
 */

import { assert, assertEquals } from "@std/assert";
import { DialogPurpose, LayoutMode } from "@exaix/tui";
import { getTheme } from "@exaix/tui/helpers/colors.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import {
  AVAILABLE_VIEWS,
  createLayoutPresetState,
  createNamedLayoutState,
  createViewPickerState,
  handleLayoutPresetKey,
  handleNamedLayoutKey,
  handleViewPickerKey,
  renderLayoutPresetDialog,
  renderNamedLayoutDialog,
  renderSwapIndicator,
  renderViewPickerDialog,
} from "@exaix/tui/dialogs/layout_dialogs.ts";

Deno.test("layout dialogs: view picker state defaults", () => {
  const state = createViewPickerState();
  assertEquals(state.isOpen, false);
  assertEquals(state.selectedIndex, 0);
  assertEquals(state.purpose, DialogPurpose.SPLIT);
});

Deno.test("layout dialogs: render view picker with purpose titles", () => {
  const theme = getTheme(true);

  const splitState = { ...createViewPickerState(), isOpen: true, purpose: DialogPurpose.SPLIT as const };
  const splitLines = renderViewPickerDialog(splitState, theme).join("\n");
  assert(splitLines.includes("Select View for New IPane"));

  const changeState = { ...createViewPickerState(), isOpen: true, purpose: DialogPurpose.CHANGE as const };
  const changeLines = renderViewPickerDialog(changeState, theme).join("\n");
  assert(changeLines.includes("Change View"));

  const newState = { ...createViewPickerState(), isOpen: true, purpose: DialogPurpose.NEW as const };
  const newLines = renderViewPickerDialog(newState, theme).join("\n");
  assert(newLines.includes("Select View"));
});

Deno.test("layout dialogs: view picker key handling", () => {
  const state = { ...createViewPickerState(), isOpen: true };

  const upResult = handleViewPickerKey(state, "up");
  assertEquals(upResult.state.selectedIndex, AVAILABLE_VIEWS.length - 1);
  assertEquals(upResult.closed, false);

  const downResult = handleViewPickerKey(upResult.state, "down");
  assertEquals(downResult.state.selectedIndex, 0);

  const numberResult = handleViewPickerKey(state, "2");
  assertEquals(numberResult.closed, true);
  assertEquals(numberResult.selectedView, AVAILABLE_VIEWS[1].name);

  const enterResult = handleViewPickerKey(state, KEYS.ENTER);
  assertEquals(enterResult.closed, true);
  assertEquals(enterResult.selectedView, AVAILABLE_VIEWS[0].name);

  const escapeResult = handleViewPickerKey(state, KEYS.ESCAPE);
  assertEquals(escapeResult.closed, true);
});

Deno.test("layout dialogs: layout preset state and keys", () => {
  const state = { ...createLayoutPresetState(), isOpen: true };

  const upResult = handleLayoutPresetKey(state, "up");
  assertEquals(upResult.state.selectedIndex, 5);
  assertEquals(upResult.closed, false);

  const numberResult = handleLayoutPresetKey(state, "4");
  assertEquals(numberResult.closed, true);
  assertEquals(numberResult.selectedPreset, "quad");

  const escapeResult = handleLayoutPresetKey(state, KEYS.ESCAPE);
  assertEquals(escapeResult.closed, true);
});

Deno.test("layout dialogs: render layout preset dialog closed is empty", () => {
  const theme = getTheme(true);
  const lines = renderLayoutPresetDialog(createLayoutPresetState(), theme);
  assertEquals(lines.length, 0);
});

Deno.test("layout dialogs: named layout save input handling", () => {
  const state = {
    ...createNamedLayoutState(),
    isOpen: true,
    mode: LayoutMode.SAVE as const,
    inputActive: true,
    inputName: "layout",
  };

  const appendResult = handleNamedLayoutKey(state, "a");
  assertEquals(appendResult.state.inputName, "layouta");
  assertEquals(appendResult.closed, false);

  const backspaceResult = handleNamedLayoutKey({ ...state, inputName: "layouta" }, KEYS.BACKSPACE);
  assertEquals(backspaceResult.state.inputName, "layout");

  const saveResult = handleNamedLayoutKey({ ...state, inputName: "layout" }, KEYS.ENTER);
  assertEquals(saveResult.closed, true);
  assertEquals(saveResult.action, "save");
  assertEquals(saveResult.layoutName, "layout");
});

Deno.test("layout dialogs: named layout load selects entry", () => {
  const state = {
    ...createNamedLayoutState(),
    isOpen: true,
    mode: LayoutMode.LOAD as const,
    layouts: ["alpha", "beta"],
    selectedIndex: 1,
  };

  const result = handleNamedLayoutKey(state, KEYS.ENTER);
  assertEquals(result.closed, true);
  assertEquals(result.action, "load");
  assertEquals(result.layoutName, "beta");
});

Deno.test("layout dialogs: render named layout dialog empty state", () => {
  const theme = getTheme(true);
  const state = { ...createNamedLayoutState(), isOpen: true, mode: LayoutMode.LOAD as const };
  const lines = renderNamedLayoutDialog(state, theme).join("\n");
  assert(lines.includes("No saved layouts"));
});

Deno.test("layout dialogs: render swap indicator", () => {
  const theme = getTheme(true);
  const pending = renderSwapIndicator("pane-a", null, theme);
  assert(pending.includes("Swapping from"));

  const swap = renderSwapIndicator("pane-a", "pane-b", theme);
  assert(swap.includes("Swap: pane-a ⇄ pane-b"));
});
