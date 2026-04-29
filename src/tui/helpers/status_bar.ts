/**
 * @module StatusBar
 * @path src/tui/helpers/status_bar.ts
 * @description TUI status bar rendering utilities with items, messages, and spinner support.
 * @architectural-layer Helpers
 * @related-files [src/helpers/colors.ts, src/helpers/spinner.ts]
 */

import { colorize, getTheme, type ITuiTheme, padEnd, visibleLength } from "./colors.ts";
import { renderSpinner, type SpinnerState } from "./spinner.ts";
import { TUI_ICON_SUCCESS } from "./constants.ts";
import { MessageType } from "@exaix/core";
import { type SpinnerStyle, StatusIndicator } from "@exaix/tui";

// ===== Status Bar Interfaces =====

export interface IStatusBarItem {
  text: string;
  color?: string;
  icon?: string;
  priority?: number;
}

export interface IStatusBarConfig {
  width: number;
  useColors: boolean;
  showSpinner?: boolean;
  spinnerStyle?: SpinnerStyle;
}

export interface IStatusBarState {
  leftItems: IStatusBarItem[];
  rightItems: IStatusBarItem[];
  message?: string;
  messageType?: MessageType;
  spinner?: SpinnerState;
}

export interface IMultiLineStatusBarState extends IStatusBarState {
  lines: string[];
  expanded: boolean;
}

// ===== Status Bar Rendering =====

/**
 * Create initial status bar state
 */
export function createStatusBarState(): IStatusBarState {
  return {
    leftItems: [],
    rightItems: [],
    message: undefined,
    messageType: undefined,
    spinner: undefined,
  };
}

/**
 * Render status bar
 */
export function renderStatusBar(
  state: IStatusBarState,
  config: IStatusBarConfig,
): string {
  const theme = getTheme(config.useColors);
  const { width } = config;

  // Build left side
  let leftContent = "";

  // Add spinner if active
  if (state.spinner?.active && config.showSpinner) {
    const spinnerStr = renderSpinner(state.spinner, {
      style: config.spinnerStyle,
      useColors: config.useColors,
    });
    leftContent += spinnerStr + " ";
  }

  // Add left items
  for (const item of state.leftItems) {
    const itemStr = formatStatusItem(item, theme);
    leftContent += itemStr + " ";
  }

  // Add message
  if (state.message) {
    const msgColor = getMessageColor(state.messageType, theme);
    leftContent += colorize(state.message, msgColor, theme.reset);
  }

  // Build right side
  let rightContent = "";
  for (const item of state.rightItems) {
    const itemStr = formatStatusItem(item, theme);
    rightContent += " " + itemStr;
  }

  // Calculate spacing
  const leftLen = visibleLength(leftContent);
  const rightLen = visibleLength(rightContent);
  const spacerLen = Math.max(1, width - leftLen - rightLen);
  const spacer = " ".repeat(spacerLen);

  // Combine and apply background
  let bar = leftContent + spacer + rightContent;

  // Truncate if needed
  if (visibleLength(bar) > width) {
    bar = truncateWithEllipsis(bar, width, theme);
  }

  // Apply status bar styling
  if (config.useColors) {
    return `\x1b[7m${padEnd(bar, width)}\x1b[0m`;
  }

  return padEnd(bar, width);
}

/**
 * Format a status item
 */
function formatStatusItem(item: IStatusBarItem, theme: ITuiTheme): string {
  let text = item.text;

  if (item.icon) {
    text = `${item.icon} ${text}`;
  }

  if (item.color) {
    text = colorize(text, item.color, theme.reset);
  }

  return text;
}

/**
 * Get color for message type
 */
function getMessageColor(type: IStatusBarState["messageType"], theme: ITuiTheme): string {
  switch (type) {
    case MessageType.SUCCESS:
      return theme.success;
    case MessageType.WARNING:
      return theme.warning;
    case MessageType.ERROR:
      return theme.error;
    case MessageType.INFO:
    default:
      return theme.info;
  }
}

/**
 * Truncate string with ellipsis, preserving ANSI codes
 */
function truncateWithEllipsis(text: string, maxLen: number, _theme: ITuiTheme): string {
  let visibleLen = 0;
  let i = 0;

  while (i < text.length && visibleLen < maxLen - 1) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && text[j] !== "m") j++;
      i = j + 1;
    } else {
      visibleLen++;
      i++;
    }
  }

  return text.slice(0, i) + "…";
}

// ===== Common Status Bar Helpers =====

/**
 * Create a view title item
 */
export function createViewTitleItem(title: string, theme: ITuiTheme): IStatusBarItem {
  return {
    text: title,
    color: theme.textBold,
    priority: 100,
  };
}

/**
 * Create a count badge item
 */
export function createCountItem(count: number, label: string, theme: ITuiTheme): IStatusBarItem {
  return {
    text: `${count} ${label}`,
    color: theme.textDim,
    priority: 50,
  };
}

/**
 * Create a status indicator item
 */
export function createStatusItem(
  status: StatusIndicator,
  label?: string,
  theme?: ITuiTheme,
): IStatusBarItem {
  const icons: Partial<Record<StatusIndicator, string>> = {
    [StatusIndicator.ACTIVE]: "●",
    [StatusIndicator.PENDING]: "◐",
    [StatusIndicator.COMPLETED]: TUI_ICON_SUCCESS,
    [StatusIndicator.FAILED]: "✗",
  } as Record<StatusIndicator, string>;

  const colors: Partial<Record<StatusIndicator, string>> = {
    [StatusIndicator.ACTIVE]: theme?.statusActive ?? "",
    [StatusIndicator.PENDING]: theme?.statusPending ?? "",
    [StatusIndicator.COMPLETED]: theme?.statusCompleted ?? "",
    [StatusIndicator.FAILED]: theme?.statusFailed ?? "",
  } as Record<StatusIndicator, string>;

  return {
    text: label ?? status,
    icon: icons[status],
    color: colors[status],
    priority: 75,
  };
}

/**
 * Create position indicator (e.g., "5/10")
 */
export function createPositionItem(current: number, total: number, theme: ITuiTheme): IStatusBarItem {
  return {
    text: `${current}/${total}`,
    color: theme.textDim,
    priority: 25,
  };
}

/**
 * Create timestamp item
 */
export function createTimestampItem(date: Date, theme: ITuiTheme): IStatusBarItem {
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return {
    text: time,
    color: theme.textDim,
    priority: 10,
  };
}

// ===== Status Bar Updates =====

/**
 * Set status bar message
 */
export function setStatusMessage(
  state: IStatusBarState,
  message: string,
  type: MessageType = MessageType.INFO,
): IStatusBarState {
  return {
    ...state,
    message,
    messageType: type,
  };
}

/**
 * Clear status bar message
 */
export function clearStatusMessage(state: IStatusBarState): IStatusBarState {
  return {
    ...state,
    message: undefined,
    messageType: undefined,
  };
}

/**
 * Set left items
 */
export function setLeftItems(state: IStatusBarState, items: IStatusBarItem[]): IStatusBarState {
  return {
    ...state,
    leftItems: items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
  };
}

/**
 * Set right items
 */
export function setRightItems(state: IStatusBarState, items: IStatusBarItem[]): IStatusBarState {
  return {
    ...state,
    rightItems: items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
  };
}

/**
 * Set spinner state
 */
export function setSpinner(state: IStatusBarState, spinner: SpinnerState | undefined): IStatusBarState {
  return {
    ...state,
    spinner,
  };
}

// ===== Multi-Line Status Bar =====

/**
 * Create multi-line status bar state
 */
export function createMultiLineStatusBarState(): IMultiLineStatusBarState {
  return {
    ...createStatusBarState(),
    lines: [],
    expanded: false,
  };
}

/**
 * Add status line
 */
export function addStatusLine(
  state: IMultiLineStatusBarState,
  line: string,
  maxLines: number = 5,
): IMultiLineStatusBarState {
  const newLines = [...state.lines, line];
  if (newLines.length > maxLines) {
    newLines.shift();
  }
  return {
    ...state,
    lines: newLines,
  };
}

/**
 * Render multi-line status bar
 */
export function renderMultiLineStatusBar(
  state: IMultiLineStatusBarState,
  config: IStatusBarConfig,
): string[] {
  const result: string[] = [];

  // Main status bar
  result.push(renderStatusBar(state, config));

  // Additional lines if expanded
  if (state.expanded && state.lines.length > 0) {
    const theme = getTheme(config.useColors);
    for (const line of state.lines) {
      const styledLine = colorize(padEnd(line, config.width), theme.textDim, theme.reset);
      result.push(styledLine);
    }
  }

  return result;
}
