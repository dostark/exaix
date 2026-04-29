/**
 * @module HelpRenderer
 * @path src/tui/helpers/help_renderer.ts
 * @description TUI help screen renderer providing consistent help displays and key binding summaries.
 * @architectural-layer Helpers
 * @related-files [src/helpers/keyboard.ts, src/helpers/dialog_base.ts]
 */

import { KEYS } from "./keyboard.ts";
import { colorize, getTheme } from "./colors.ts";
import { renderBoxBottom, renderBoxLine, renderBoxLineCentered, renderBoxTop } from "./dialog_base.ts";
import { ScrollDirection } from "@exaix/tui";
import type { IKeyBinding } from "./keyboard.ts";

// ===== Help Interfaces =====

export interface IHelpItem {
  key: string;
  description: string;
  category?: string;
}

export interface IHelpSection {
  title: string;
  items: IHelpItem[];
}

export interface IHelpScreenOptions {
  title: string;
  sections: IHelpSection[];
  footer?: string;
  width?: number;
  useColors?: boolean;
}

/**
 * Simple help dialog state
 */
export interface IHelpDialogState {
  visible: boolean;
  scrollOffset: number;
  content: string[];
}

// ===== Help Screen Rendering =====

/**
 * Render a help screen
 */
export function renderHelpScreen(options: IHelpScreenOptions): string[] {
  const { title, sections, footer, width = 60, useColors = true } = options;
  const theme = getTheme(useColors);
  const innerWidth = width - 2;
  const lines: string[] = [];

  // Top border with title
  lines.push(renderBoxTop(innerWidth, ` ${title} `, theme));

  // Empty line
  lines.push(renderBoxLine("", innerWidth, theme));

  // Render each section
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Section title
    const sectionTitle = colorize(section.title, theme.h2, theme.reset);
    lines.push(renderBoxLine(`  ${sectionTitle}`, innerWidth, theme));
    lines.push(renderBoxLine("", innerWidth, theme));

    // Items
    for (const item of section.items) {
      const keyStr = colorize(item.key.padEnd(15), theme.code, theme.reset);
      const line = `    ${keyStr} ${item.description}`;
      lines.push(renderBoxLine(line, innerWidth, theme));
    }

    // Add space between sections (except last)
    if (i < sections.length - 1) {
      lines.push(renderBoxLine("", innerWidth, theme));
    }
  }

  // Empty line before footer
  lines.push(renderBoxLine("", innerWidth, theme));

  // Footer
  if (footer) {
    const footerText = colorize(footer, theme.textDim, theme.reset);
    lines.push(renderBoxLineCentered(footerText, innerWidth, theme));
    lines.push(renderBoxLine("", innerWidth, theme));
  }

  // Bottom border
  lines.push(renderBoxBottom(innerWidth, theme));

  return lines;
}

/**
 * Convert KeyBindings to HelpSections
 */
export function keyBindingsToHelpSections<T extends string>(
  bindings: IKeyBinding<T>[],
): IHelpSection[] {
  // Group by category
  const categories = new Map<string, IHelpItem[]>();

  for (const binding of bindings) {
    const category = binding.category ?? "General";
    const items = categories.get(category) ?? [];
    items.push({
      key: binding.key,
      description: binding.description,
      category: binding.category,
    });
    categories.set(category, items);
  }

  // Convert to sections
  const sections: IHelpSection[] = [];
  for (const [title, items] of categories) {
    sections.push({ title, items });
  }

  return sections;
}

// ===== Standard Help Sections =====

/**
 * Standard navigation help section
 */
export function getNavigationHelpSection(): IHelpSection {
  return {
    title: "Navigation",
    items: [
      { key: KEYS.UP, description: "Move up" },
      { key: KEYS.DOWN, description: "Move down" },
      { key: KEYS.HOME, description: "Go to first item" },
      { key: KEYS.END, description: "Go to last item" },
      { key: KEYS.ENTER, description: "Select/expand item" },
      { key: KEYS.ESCAPE, description: "Go back/cancel" },
    ],
  };
}

/**
 * Standard search help section
 */
export function getSearchHelpSection(): IHelpSection {
  return {
    title: "Search",
    items: [
      { key: KEYS.S, description: "Start search" },
      { key: KEYS.ENTER, description: "Execute search" },
      { key: KEYS.ESCAPE, description: "Cancel search" },
      { key: KEYS.BACKSPACE, description: "Delete character" },
    ],
  };
}

/**
 * Standard tree help section
 */
export function getTreeHelpSection(): IHelpSection {
  return {
    title: "Tree Navigation",
    items: [
      { key: KEYS.ENTER, description: "Expand/collapse node" },
      { key: KEYS.LEFT, description: "Collapse node or go to parent" },
      { key: KEYS.RIGHT, description: "Expand node or go to first child" },
      { key: KEYS.SPACE, description: "Toggle selection" },
    ],
  };
}

/**
 * Standard global help section
 */
export function getGlobalHelpSection(): IHelpSection {
  return {
    title: "Global",
    items: [
      { key: KEYS.QUESTION, description: "Toggle help" },
      { key: KEYS.R, description: "Refresh" },
      { key: KEYS.TAB, description: "Next panel/pane" },
      { key: KEYS.SHIFT_TAB, description: "Previous panel/pane" },
      { key: KEYS.Q, description: "Quit" },
    ],
  };
}

// ===== Quick Help Bar =====

/**
 * Render a quick help bar (single line)
 */
export function renderQuickHelp(
  items: { key: string; action: string }[],
  useColors: boolean = true,
): string {
  const theme = getTheme(useColors);
  const parts: string[] = [];

  for (const item of items) {
    const keyPart = colorize(item.key, theme.code, theme.reset);
    parts.push(`${keyPart} ${item.action}`);
  }

  return parts.join("  ");
}

/**
 * Get standard quick help items
 */
export function getStandardQuickHelp(): { key: string; action: string }[] {
  return [
    { key: KEYS.QUESTION, action: "Help" },
    { key: KEYS.R, action: "Refresh" },
    { key: KEYS.S, action: "Search" },
    { key: KEYS.Q, action: "Quit" },
  ];
}

// ===== Help Dialog Operations =====

/**
 * Create help dialog state
 */
export function createHelpDialogState(): IHelpDialogState {
  return {
    visible: false,
    scrollOffset: 0,
    content: [],
  };
}

/**
 * Toggle help dialog
 */
export function toggleHelpDialog(
  state: IHelpDialogState,
  content?: string[],
): IHelpDialogState {
  return {
    ...state,
    visible: !state.visible,
    content: content ?? state.content,
    scrollOffset: 0,
  };
}

/**
 * Scroll help dialog
 */
export function scrollHelpDialog(
  state: IHelpDialogState,
  direction: ScrollDirection,
  visibleLines: number,
): IHelpDialogState {
  if (!state.visible) return state;

  const maxOffset = Math.max(0, state.content.length - visibleLines);
  let newOffset = state.scrollOffset;

  if (direction === ScrollDirection.UP) {
    newOffset = Math.max(0, newOffset - 1);
  } else {
    newOffset = Math.min(maxOffset, newOffset + 1);
  }

  return {
    ...state,
    scrollOffset: newOffset,
  };
}

/**
 * Handle help dialog key
 */
export function handleHelpKey(
  state: IHelpDialogState,
  key: string,
  visibleLines: number,
): { state: IHelpDialogState; handled: boolean } {
  if (!state.visible) {
    if (key === "?" || key === "F1") {
      return {
        state: toggleHelpDialog(state),
        handled: true,
      };
    }
    return { state, handled: false };
  }

  switch (key) {
    case KEYS.ESCAPE:
    case KEYS.QUESTION:
    case KEYS.Q:
      return {
        state: toggleHelpDialog(state),
        handled: true,
      };
    case KEYS.UP:
    case KEYS.K:
      return {
        state: scrollHelpDialog(state, ScrollDirection.UP, visibleLines),
        handled: true,
      };
    case KEYS.DOWN:
    case KEYS.J:
      return {
        state: scrollHelpDialog(state, ScrollDirection.DOWN, visibleLines),
        handled: true,
      };
    case KEYS.HOME:
      return {
        state: { ...state, scrollOffset: 0 },
        handled: true,
      };
    case KEYS.END:
      return {
        state: {
          ...state,
          scrollOffset: Math.max(0, state.content.length - visibleLines),
        },
        handled: true,
      };
    default:
      // Consume all keys when help is visible
      return { state, handled: true };
  }
}
