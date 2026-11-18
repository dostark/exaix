/**
 * @module TuiDialogBox
 * @path packages/tui/src/helpers/dialog_box.ts
 * @description The box-drawing characters and the border and row renderers that the dialogs and the help screen share.
 * @architectural-layer Tui
 * @dependencies [./colors.ts]
 * @related-files [packages/tui/src/helpers/dialog_base.ts, packages/tui/src/helpers/dialog_rendering.ts, packages/tui/src/helpers/help_renderer.ts]
 */

import { colorize, type ITuiTheme, padEnd, visibleLength } from "./colors.ts";

// Box Drawing Characters

export const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeLeft: "├",
  teeRight: "┤",
  teeTop: "┬",
  teeBottom: "┴",
  cross: "┼",
  // Double line variants
  doubleHorizontal: "═",
  doubleVertical: "║",
  doubleTopLeft: "╔",
  doubleTopRight: "╗",
  doubleBottomLeft: "╚",
  doubleBottomRight: "╝",
} as const;

/**
 * Render top border with optional title
 */
export function renderBoxTop(width: number, title: string, theme: ITuiTheme): string {
  const titleLen = visibleLength(title);
  const leftLen = 2;
  const rightLen = Math.max(0, width - leftLen - titleLen);
  const left = BOX.horizontal.repeat(leftLen);
  const right = BOX.horizontal.repeat(rightLen);
  return colorize(
    `${BOX.topLeft}${left}${title}${right}${BOX.topRight}`,
    theme.border,
    theme.reset,
  );
}

/**
 * Render bottom border
 */
export function renderBoxBottom(width: number, theme: ITuiTheme): string {
  return colorize(
    `${BOX.bottomLeft}${BOX.horizontal.repeat(width)}${BOX.bottomRight}`,
    theme.border,
    theme.reset,
  );
}

/**
 * Render a box line with content
 */
export function renderBoxLine(content: string, width: number, theme: ITuiTheme): string {
  const paddedContent = padEnd(content, width);
  const border = colorize(BOX.vertical, theme.border, theme.reset);
  return `${border}${paddedContent}${border}`;
}

/**
 * Render a centered box line
 */
export function renderBoxLineCentered(content: string, width: number, theme: ITuiTheme): string {
  const contentLen = visibleLength(content);
  const leftPad = Math.floor((width - contentLen) / 2);
  const rightPad = width - contentLen - leftPad;
  const paddedContent = " ".repeat(leftPad) + content + " ".repeat(rightPad);
  const border = colorize(BOX.vertical, theme.border, theme.reset);
  return `${border}${paddedContent}${border}`;
}
