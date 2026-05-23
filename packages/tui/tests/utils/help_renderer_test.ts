/**
 * @module TUIHelpRendererTest
 * @path packages/tui/tests/utils/help_renderer_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the logic for rendering help screens in the terminal, ensuring
 * that key bindings and action categories are clearly presented.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  createHelpDialogState,
  getGlobalHelpSection,
  getNavigationHelpSection,
  getSearchHelpSection,
  getStandardQuickHelp,
  getTreeHelpSection,
  handleHelpKey,
  type IHelpDialogState,
  type IHelpSection,
  keyBindingsToHelpSections,
  renderHelpScreen,
  renderQuickHelp,
  scrollHelpDialog,
  toggleHelpDialog,
} from "@exaix/tui/helpers/help_renderer.ts";
import type { IKeyBinding } from "@exaix/tui/helpers/keyboard.ts";
import { ScrollDirection } from "@exaix/tui";

// ===== renderHelpScreen tests =====

Deno.test("renderHelpScreen: renders basic help screen", () => {
  const result = renderHelpScreen({
    title: "Test Help",
    sections: [],
  });
  assertExists(result);
  assertEquals(result.length > 0, true);
  assertEquals(result.some((l: string) => l.includes("Test Help")), true);
});

Deno.test("renderHelpScreen: renders sections", () => {
  const sections: IHelpSection[] = [
    {
      title: "Navigation",
      items: [
        { key: "↑", description: "Move up" },
        { key: "↓", description: "Move down" },
      ],
    },
  ];
  const result = renderHelpScreen({
    title: "Help",
    sections,
  });
  assertEquals(result.some((l: string) => l.includes("Navigation")), true);
  assertEquals(result.some((l: string) => l.includes("Move up")), true);
});

Deno.test("renderHelpScreen: renders multiple sections", () => {
  const sections: IHelpSection[] = [
    {
      title: "Section 1",
      items: [{ key: "a", description: "Action A" }],
    },
    {
      title: "Section 2",
      items: [{ key: "b", description: "Action B" }],
    },
  ];
  const result = renderHelpScreen({
    title: "Help",
    sections,
  });
  assertEquals(result.some((l: string) => l.includes("Section 1")), true);
  assertEquals(result.some((l: string) => l.includes("Section 2")), true);
});

Deno.test("renderHelpScreen: renders footer", () => {
  const result = renderHelpScreen({
    title: "Help",
    sections: [],
    footer: "Press ? to close",
  });
  assertEquals(result.some((l: string) => l.includes("close")), true);
});

Deno.test("renderHelpScreen: respects width option", () => {
  const result = renderHelpScreen({
    title: "Help",
    sections: [],
    width: 80,
  });
  assertExists(result);
  // Width applies to box rendering
});

Deno.test("renderHelpScreen: respects useColors option", () => {
  const resultColors = renderHelpScreen({
    title: "Help",
    sections: [{ title: "Test", items: [{ key: "x", description: "Test" }] }],
    useColors: true,
  });
  const _resultNoColors = renderHelpScreen({
    title: "Help",
    sections: [{ title: "Test", items: [{ key: "x", description: "Test" }] }],
    useColors: false,
  });
  // With colors should have ANSI codes
  assertEquals(resultColors.some((l: string) => l.includes("\x1b[")), true);
});

// ===== keyBindingsToHelpSections tests =====

Deno.test("keyBindingsToHelpSections: converts bindings to sections", () => {
  const bindings: IKeyBinding<"action1" | "action2">[] = [
    { key: "a", action: "action1", description: "First action", category: "Actions" },
    { key: "b", action: "action2", description: "Second action", category: "Actions" },
  ];
  const sections = keyBindingsToHelpSections(bindings);
  assertEquals(sections.length, 1);
  assertEquals(sections[0].title, "Actions");
  assertEquals(sections[0].items.length, 2);
});

Deno.test("keyBindingsToHelpSections: groups by category", () => {
  const bindings: IKeyBinding<"nav" | "action">[] = [
    { key: "up", action: "nav", description: "Up", category: "Navigation" },
    { key: "down", action: "nav", description: "Down", category: "Navigation" },
    { key: "a", action: "action", description: "Act", category: "Actions" },
  ];
  const sections = keyBindingsToHelpSections(bindings);
  assertEquals(sections.length, 2);
});

Deno.test("keyBindingsToHelpSections: defaults to General category", () => {
  const bindings: IKeyBinding<"test">[] = [
    { key: "t", action: "test", description: "Test" },
  ];
  const sections = keyBindingsToHelpSections(bindings);
  assertEquals(sections[0].title, "General");
});

// ===== Standard help sections tests =====

Deno.test("getNavigationHelpSection: returns navigation section", () => {
  const section = getNavigationHelpSection();
  assertEquals(section.title, "Navigation");
  assertEquals(section.items.length > 0, true);
  assertEquals(
    section.items.some((i: { key: string; description?: string; action?: string }) =>
      i.key.includes(ScrollDirection.UP)
    ),
    true,
  );
  assertEquals(
    section.items.some((i: { key: string; description?: string; action?: string }) =>
      i.key.includes(ScrollDirection.DOWN)
    ),
    true,
  );
});

Deno.test("getSearchHelpSection: returns search section", () => {
  const section = getSearchHelpSection();
  assertEquals(section.title, "Search");
  assertEquals(section.items.length > 0, true);
  assertEquals(
    section.items.some((i: { key: string; description?: string; action?: string }) =>
      i.description?.includes("search")
    ),
    true,
  );
});

Deno.test("getTreeHelpSection: returns tree section", () => {
  const section = getTreeHelpSection();
  assertEquals(section.title, "Tree Navigation");
  assertEquals(section.items.length > 0, true);
  assertEquals(
    section.items.some((i: { key: string; description?: string; action?: string }) =>
      i.description?.includes("Expand")
    ),
    true,
  );
});

Deno.test("getGlobalHelpSection: returns global section", () => {
  const section = getGlobalHelpSection();
  assertEquals(section.title, "Global");
  assertEquals(section.items.length > 0, true);
  assertEquals(section.items.some((i: { key: string; description?: string; action?: string }) => i.key === "?"), true);
  assertEquals(section.items.some((i: { key: string; description?: string; action?: string }) => i.key === "q"), true);
});

// ===== renderQuickHelp tests =====

Deno.test("renderQuickHelp: renders quick help bar", () => {
  const items = [
    { key: "?", action: "Help" },
    { key: "q", action: "Quit" },
  ];
  const result = renderQuickHelp(items, false);
  assertEquals(result.includes("?"), true);
  assertEquals(result.includes("Help"), true);
  assertEquals(result.includes("q"), true);
  assertEquals(result.includes("Quit"), true);
});

Deno.test("renderQuickHelp: renders with colors", () => {
  const items = [{ key: "x", action: "Test" }];
  const result = renderQuickHelp(items, true);
  assertEquals(result.includes("\x1b["), true);
});

Deno.test("renderQuickHelp: separates items with spaces", () => {
  const items = [
    { key: "a", action: "A" },
    { key: "b", action: "B" },
  ];
  const result = renderQuickHelp(items, false);
  assertEquals(result.includes("  "), true);
});

Deno.test("getStandardQuickHelp: returns standard items", () => {
  const items = getStandardQuickHelp();
  assertEquals(items.length > 0, true);
  assertEquals(items.some((i: { key: string; action?: string }) => i.key === "?"), true);
  assertEquals(items.some((i: { key: string; action?: string }) => i.action === "Help"), true);
});

// ===== Help Dialog State tests =====

Deno.test("createHelpDialogState: creates initial state", () => {
  const state = createHelpDialogState();
  assertEquals(state.visible, false);
  assertEquals(state.scrollOffset, 0);
  assertEquals(state.content, []);
});

Deno.test("toggleHelpDialog: toggles visibility", () => {
  let state = createHelpDialogState();
  state = toggleHelpDialog(state);
  assertEquals(state.visible, true);
  state = toggleHelpDialog(state);
  assertEquals(state.visible, false);
});

Deno.test("toggleHelpDialog: sets content", () => {
  const state = createHelpDialogState();
  const content = ["Line 1", "Line 2"];
  const toggled = toggleHelpDialog(state, content);
  assertEquals(toggled.content, content);
});

Deno.test("toggleHelpDialog: resets scroll offset", () => {
  let state: IHelpDialogState = {
    visible: true,
    scrollOffset: 10,
    content: ["Line 1"],
  };
  state = toggleHelpDialog(state);
  assertEquals(state.scrollOffset, 0);
});

Deno.test("scrollHelpDialog: scrolls down", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 0,
    content: Array(20).fill("Line"),
  };
  const scrolled = scrollHelpDialog(state, ScrollDirection.DOWN, 10);
  assertEquals(scrolled.scrollOffset, 1);
});

Deno.test("scrollHelpDialog: scrolls up", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 5,
    content: Array(20).fill("Line"),
  };
  const scrolled = scrollHelpDialog(state, ScrollDirection.UP, 10);
  assertEquals(scrolled.scrollOffset, 4);
});

Deno.test("scrollHelpDialog: clamps at 0", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 0,
    content: Array(20).fill("Line"),
  };
  const scrolled = scrollHelpDialog(state, ScrollDirection.UP, 10);
  assertEquals(scrolled.scrollOffset, 0);
});

Deno.test("scrollHelpDialog: clamps at max", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 10,
    content: Array(20).fill("Line"),
  };
  const scrolled = scrollHelpDialog(state, ScrollDirection.DOWN, 10);
  assertEquals(scrolled.scrollOffset, 10);
});

Deno.test("scrollHelpDialog: does nothing when not visible", () => {
  const state: IHelpDialogState = {
    visible: false,
    scrollOffset: 0,
    content: Array(20).fill("Line"),
  };
  const scrolled = scrollHelpDialog(state, ScrollDirection.DOWN, 10);
  assertEquals(scrolled.scrollOffset, 0);
});

// ===== handleHelpKey tests =====

Deno.test("handleHelpKey: opens help with ?", () => {
  const state = createHelpDialogState();
  const { state: newState, handled } = handleHelpKey(state, "?", 10);
  assertEquals(handled, true);
  assertEquals(newState.visible, true);
});

Deno.test("handleHelpKey: opens help with F1", () => {
  const state = createHelpDialogState();
  const { state: newState, handled } = handleHelpKey(state, "F1", 10);
  assertEquals(handled, true);
  assertEquals(newState.visible, true);
});

Deno.test("handleHelpKey: closes help with escape", () => {
  const state: IHelpDialogState = { visible: true, scrollOffset: 0, content: [] };
  const { state: newState, handled } = handleHelpKey(state, "escape", 10);
  assertEquals(handled, true);
  assertEquals(newState.visible, false);
});

Deno.test("handleHelpKey: closes help with ?", () => {
  const state: IHelpDialogState = { visible: true, scrollOffset: 0, content: [] };
  const { state: newState, handled } = handleHelpKey(state, "?", 10);
  assertEquals(handled, true);
  assertEquals(newState.visible, false);
});

Deno.test("handleHelpKey: closes help with q", () => {
  const state: IHelpDialogState = { visible: true, scrollOffset: 0, content: [] };
  const { state: newState, handled } = handleHelpKey(state, "q", 10);
  assertEquals(handled, true);
  assertEquals(newState.visible, false);
});

Deno.test("handleHelpKey: scrolls up with up key", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 5,
    content: Array(20).fill("Line"),
  };
  const { state: newState, handled } = handleHelpKey(state, ScrollDirection.UP, 10);
  assertEquals(handled, true);
  assertEquals(newState.scrollOffset, 4);
});

Deno.test("handleHelpKey: scrolls up with k key", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 5,
    content: Array(20).fill("Line"),
  };
  const { state: newState, handled } = handleHelpKey(state, "k", 10);
  assertEquals(handled, true);
  assertEquals(newState.scrollOffset, 4);
});

Deno.test("handleHelpKey: scrolls down with down key", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 0,
    content: Array(20).fill("Line"),
  };
  const { state: newState, handled } = handleHelpKey(state, ScrollDirection.DOWN, 10);
  assertEquals(handled, true);
  assertEquals(newState.scrollOffset, 1);
});

Deno.test("handleHelpKey: scrolls down with j key", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 0,
    content: Array(20).fill("Line"),
  };
  const { state: newState, handled } = handleHelpKey(state, "j", 10);
  assertEquals(handled, true);
  assertEquals(newState.scrollOffset, 1);
});

Deno.test("handleHelpKey: jumps to start with home", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 10,
    content: Array(20).fill("Line"),
  };
  const { state: newState, handled } = handleHelpKey(state, "home", 10);
  assertEquals(handled, true);
  assertEquals(newState.scrollOffset, 0);
});

Deno.test("handleHelpKey: jumps to end with end", () => {
  const state: IHelpDialogState = {
    visible: true,
    scrollOffset: 0,
    content: Array(20).fill("Line"),
  };
  const { state: newState, handled } = handleHelpKey(state, "end", 10);
  assertEquals(handled, true);
  assertEquals(newState.scrollOffset, 10); // 20 - 10
});

Deno.test("handleHelpKey: consumes unknown keys when visible", () => {
  const state: IHelpDialogState = { visible: true, scrollOffset: 0, content: [] };
  const { handled } = handleHelpKey(state, "x", 10);
  assertEquals(handled, true);
});

Deno.test("handleHelpKey: does not handle keys when not visible", () => {
  const state = createHelpDialogState();
  const { handled } = handleHelpKey(state, "x", 10);
  assertEquals(handled, false);
});
