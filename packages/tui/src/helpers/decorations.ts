/**
 * @module Decorations
 * @path packages/tui/src/helpers/decorations.ts
 * @description TUI decoration constants and drawing utilities for boxes, separators, and icons.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files [apps/tui/src/daemon_control_view.ts, apps/tui/src/agent_status_view.ts, apps/tui/src/monitor_view.ts]
 */

// Box Drawing Characters

/**
 * Standard fixed-width box drawing components for TUI panels.
 * Width is optimized for 80-character terminals with padding.
 */
export const TUI_BOX = {
  TOP_LEFT: "╔",
  TOP_RIGHT: "╗",
  BOTTOM_LEFT: "╚",
  BOTTOM_RIGHT: "╝",
  HORIZONTAL: "═",
  VERTICAL: "║",
  TEE_LEFT: "╠",
  TEE_RIGHT: "╣",
  TEE_TOP: "╦",
  TEE_BOTTOM: "╩",
  CROSS: "╬",
} as const;

/**
 * Pre-rendered full-width horizontal lines (65 chars usually)
 */
export const TUI_LINE = {
  THICK: TUI_BOX.HORIZONTAL.repeat(61),
  THIN: "─".repeat(61),
  DASHED: "┄".repeat(61),
} as const;

/**
 * Pre-rendered full-width box sections
 */
export const TUI_SECTION = {
  TOP: `${TUI_BOX.TOP_LEFT}${TUI_LINE.THICK}${TUI_BOX.TOP_RIGHT}`,
  MIDDLE: `${TUI_BOX.TEE_LEFT}${TUI_LINE.THICK}${TUI_BOX.TEE_RIGHT}`,
  BOTTOM: `${TUI_BOX.BOTTOM_LEFT}${TUI_LINE.THICK}${TUI_BOX.BOTTOM_RIGHT}`,
  EMPTY: `${TUI_BOX.VERTICAL}${" ".repeat(61)}${TUI_BOX.VERTICAL}`,
} as const;

// Separators

export const TUI_SEPARATOR = {
  HEAVY: "━".repeat(40),
  LIGHT: "─".repeat(40),
  DOTS: "┈".repeat(40),
} as const;

// Status Icons

export const TUI_ICON = {
  SUCCESS: "✔",
  FAILURE: "✘",
  WARNING: "⚠",
  INFO: "ℹ",
  DEBUG: "🔍",
  PENDING: "◐",
  ACTIVE: "●",
  INACTIVE: "○",
  BULLET: "•",
  BULLET_BOLD: "●",
  ARROW_RIGHT: "→",
  ARROW_LEFT: "←",
  ARROW_UP: "↑",
  ARROW_DOWN: "↓",
  LOCK: "🔒",
  UNLOCK: "🔓",
  GEAR: "⚙",
  LIGHTNING: "⚡",
  FIRE: "🔥",
  STAR: "⭐",
  CLOCK: "🕒",
  CALENDAR: "📅",
  USER: "👤",
  AGENT: "🤖",
  PORTAL: "🌀",
  MISSION: "🎯",
  WORKSPACE: "📂",
  MEMORY: "🧠",
} as const;

/**
 * Progress bar characters
 */
export const TUI_PROGRESS = {
  FULL: "█",
  DARK: "▓",
  MEDIUM: "▒",
  LIGHT: "░",
  EMPTY: " ",
} as const;
