/**
 * @module DialogRendering
 * @path packages/tui/src/helpers/dialog_rendering.ts
 * @description Shared dialog rendering utilities providing common patterns for dialog buttons, titles, and lines.
 * @architectural-layer Helpers
 * @ungrounded
 * @related-files ["packages/tui/src/helpers/dialog_base.ts"]
 */

import { colorize, type ITuiTheme, visibleLength } from "./colors.ts";
import { renderBoxBottom, renderBoxLine, renderBoxTop, wrapToWidth } from "./dialog_base.ts";

// ===== Common Rendering Functions =====

/**
 * Renders a dialog title bar with consistent styling
 */
export function renderDialogTitle(
  title: string,
  innerWidth: number,
  theme: ITuiTheme,
): string {
  const titleLine = ` ${title} `;
  return renderBoxTop(innerWidth, titleLine, theme);
}

/**
 * Renders a standard dialog content line
 */
export function renderDialogLine(
  content: string,
  innerWidth: number,
  theme: ITuiTheme,
): string {
  return renderBoxLine(content, innerWidth, theme);
}

/**
 * Renders an empty dialog line
 */
export function renderEmptyDialogLine(innerWidth: number, theme: ITuiTheme): string {
  return renderBoxLine("", innerWidth, theme);
}

/**
 * Renders a focused button with consistent styling
 */
export function renderFocusedButton(
  text: string,
  isFocused: boolean,
  theme: ITuiTheme,
): string {
  if (isFocused) {
    return colorize(`[${text}]`, theme.primary);
  }
  return `[${text}]`;
}

/**
 * Renders a standard button with consistent styling
 */
export function renderButton(text: string): string {
  return `[${text}]`;
}

/**
 * Renders a labeled input field with cursor
 */
export function renderInputField(
  label: string,
  value: string,
  cursorPos: number,
  maxWidth: number,
  theme: ITuiTheme,
): string {
  const displayValue = value.length <= maxWidth ? value : `...${value.slice(-maxWidth + 3)}`;
  const beforeCursor = displayValue.slice(0, cursorPos);
  const atCursor = displayValue.slice(cursorPos, cursorPos + 1) || " ";
  const afterCursor = displayValue.slice(cursorPos + 1);

  const line = `${label}: ${beforeCursor}${colorize(atCursor, theme.primary)}${afterCursor}`;
  return line;
}

/**
 * Renders a multi-line message with word wrapping
 */
export function renderWrappedMessage(
  message: string | string[],
  maxWidth: number,
  theme: ITuiTheme,
): string[] {
  const messages = Array.isArray(message) ? message : wrapToWidth(message, maxWidth);
  return messages.map((msg) => renderDialogLine(`  ${msg}`, maxWidth + 4, theme));
}

/**
 * Renders a list of options with focus indicator
 */
export function renderOptionList(
  options: string[],
  focusIndex: number,
  maxWidth: number,
  theme: ITuiTheme,
): string[] {
  return options.map((option, index) => {
    const prefix = index === focusIndex ? colorize("▶ ", theme.primary) : "  ";
    return renderDialogLine(`${prefix}${option}`, maxWidth + 4, theme);
  });
}

/**
 * Renders dialog buttons in a standard layout
 */
export function renderDialogButtons(
  buttons: Array<{ text: string; focused: boolean }>,
  innerWidth: number,
  theme: ITuiTheme,
): string {
  const buttonTexts = buttons.map((btn) =>
    btn.focused ? renderFocusedButton(btn.text, true, theme) : renderButton(btn.text)
  );
  const buttonLine = buttonTexts.join(" ");
  const padding = Math.max(0, innerWidth - visibleLength(buttonLine));
  return renderDialogLine(`${" ".repeat(padding)}${buttonLine}`, innerWidth, theme);
}

// ===== Utility Functions =====

/**
 * Calculates the optimal dialog width based on content
 */
export function calculateDialogWidth(content: string[], minWidth = 40, maxWidth = 80): number {
  const contentWidth = Math.max(...content.map((line) => visibleLength(line))) + 4;
  return Math.min(Math.max(contentWidth, minWidth), maxWidth);
}

/**
 * Creates a standard dialog border
 */
export function createDialogBorder(
  lines: string[],
  title: string,
  theme: ITuiTheme,
): string[] {
  const contentWidth = Math.max(...lines.map((line) => visibleLength(line))) + 4;
  const titleLine = ` ${title} `;
  const innerWidth = Math.max(contentWidth, visibleLength(titleLine));
  const borderedLines: string[] = [];

  // Top border with title
  borderedLines.push(renderDialogTitle(title, innerWidth, theme));

  // Content lines
  for (const line of lines) {
    borderedLines.push(renderDialogLine(`  ${line}`, innerWidth, theme));
  }

  // Bottom border
  borderedLines.push(renderBoxBottom(innerWidth, theme));

  return borderedLines;
}

// Note: box rendering + wrapping helpers are imported from dialog_base.ts
