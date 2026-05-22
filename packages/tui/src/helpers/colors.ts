/**
 * @module Colors
 * @path packages/tui/src/helpers/colors.ts
 * @description TUI color theme system and ANSI styling utilities.
 * @architectural-layer Helpers
 * @related-files ["packages/tui/src/helpers/tree_view.ts", "packages/tui/src/helpers/status_bar.ts"]
 */

// ===== Theme Interface =====

export interface ITuiTheme {
  // UI Elements
  primary: string;
  secondary: string;
  accent: string;
  border: string;
  borderActive: string;

  // Text
  text: string;
  textDim: string;
  textInverted: string;
  textBold: string;

  // Status/Semantic
  success: string;
  warning: string;
  error: string;
  info: string;

  // Tree View
  treeExpanded: string;
  treeCollapsed: string;
  treeLeaf: string;
  treeSelected: string;

  // Components
  h1: string;
  h2: string;
  h3: string;
  link: string;
  code: string;
  codeBlock: string;

  // Categories
  categoryPattern: string;
  categoryDecision: string;
  categoryTroubleshooting: string;
  categoryInsight: string;

  // Confidence
  confidenceHigh: string;
  confidenceMedium: string;
  confidenceLow: string;

  // Status indicators
  statusActive: string;
  statusPending: string;
  statusCompleted: string;
  statusFailed: string;

  // TUI Specific
  spinner: string;
  selection: string;
  selectionText: string;
  reset: string;
}

// ===== ANSI Color Codes =====

export const ANSI = {
  // Reset
  reset: "\x1b[0m",

  // Styles
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  inverse: "\x1b[7m",
  strikethrough: "\x1b[9m",

  // Foreground Colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Bright Foreground Colors
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  // Background Colors
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
} as const;

// ===== Default Theme =====

export const defaultTheme: ITuiTheme = {
  // UI Elements
  primary: ANSI.cyan,
  secondary: ANSI.blue,
  accent: ANSI.magenta,
  border: ANSI.brightBlack,
  borderActive: ANSI.cyan,

  // Text
  text: "",
  textDim: ANSI.dim,
  textBold: ANSI.bold,
  textInverted: `${ANSI.inverse}${ANSI.white}`,

  // Status
  success: ANSI.green,
  warning: ANSI.yellow,
  error: ANSI.red,
  info: ANSI.blue,

  // Tree View
  treeExpanded: ANSI.cyan,
  treeCollapsed: ANSI.brightBlack,
  treeLeaf: ANSI.brightBlack,
  treeSelected: `${ANSI.inverse}${ANSI.cyan}`,

  // Headers
  h1: `${ANSI.bold}${ANSI.cyan}`,
  h2: `${ANSI.bold}${ANSI.blue}`,
  h3: `${ANSI.bold}${ANSI.magenta}`,

  // Link
  link: ANSI.cyan,

  // Code
  code: ANSI.yellow,
  codeBlock: `${ANSI.dim}${ANSI.yellow}`,

  // Categories
  categoryPattern: ANSI.blue,
  categoryDecision: ANSI.green,
  categoryTroubleshooting: ANSI.yellow,
  categoryInsight: ANSI.magenta,

  // Confidence
  confidenceHigh: ANSI.green,
  confidenceMedium: ANSI.yellow,
  confidenceLow: ANSI.red,

  // Status indicators
  statusActive: ANSI.green,
  statusPending: ANSI.yellow,
  statusCompleted: ANSI.brightBlack,
  statusFailed: ANSI.red,

  // TUI Specific
  spinner: ANSI.cyan,
  selection: ANSI.cyan,
  selectionText: ANSI.black,
  reset: ANSI.reset,
};

// ===== No-Color Theme =====

function createEmptyTheme(): ITuiTheme {
  const empty = "";
  return {
    primary: empty,
    secondary: empty,
    accent: empty,
    border: empty,
    borderActive: empty,
    text: empty,
    textDim: empty,
    textInverted: empty,
    textBold: empty,
    success: empty,
    warning: empty,
    error: empty,
    info: empty,
    treeExpanded: empty,
    treeCollapsed: empty,
    treeLeaf: empty,
    treeSelected: empty,
    h1: empty,
    h2: empty,
    h3: empty,
    link: empty,
    code: empty,
    codeBlock: empty,
    categoryPattern: empty,
    categoryDecision: empty,
    categoryTroubleshooting: empty,
    categoryInsight: empty,
    confidenceHigh: empty,
    confidenceMedium: empty,
    confidenceLow: empty,
    statusActive: empty,
    statusPending: empty,
    statusCompleted: empty,
    statusFailed: empty,
    spinner: empty,
    selection: empty,
    selectionText: empty,
    reset: empty,
  };
}

export const noColorTheme: ITuiTheme = createEmptyTheme();

// ===== Theme Manager =====

/**
 * Get the active theme based on color preference
 */
export function getTheme(useColors: boolean): ITuiTheme {
  return useColors ? defaultTheme : noColorTheme;
}

// ===== Color Utilities =====

/**
 * Wrap text with a color code and reset
 */
export function colorize(text: string, color: string, reset: string = ANSI.reset): string {
  if (!color) return text;
  return `${color}${text}${reset}`;
}

/**
 * Make text bold
 */
export function bold(text: string, useColors: boolean = true): string {
  return useColors ? colorize(text, ANSI.bold) : text;
}

/**
 * Make text dim
 */
export function dim(text: string, useColors: boolean = true): string {
  return useColors ? colorize(text, ANSI.dim) : text;
}

/**
 * Format success text (green)
 */
export function success(text: string, useColors: boolean = true): string {
  return useColors ? colorize(text, ANSI.green) : text;
}

/**
 * Format warning text (yellow)
 */
export function warning(text: string, useColors: boolean = true): string {
  return useColors ? colorize(text, ANSI.yellow) : text;
}

/**
 * Format error text (red)
 */
export function error(text: string, useColors: boolean = true): string {
  return useColors ? colorize(text, ANSI.red) : text;
}

/**
 * Format info text (blue)
 */
export function info(text: string, useColors: boolean = true): string {
  return useColors ? colorize(text, ANSI.blue) : text;
}

/**
 * Strip all ANSI codes from text
 */
export function stripAnsi(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Get visible length of text (excluding ANSI codes)
 */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Pad string to width, accounting for ANSI codes
 */
export function padEnd(text: string, width: number, char: string = " "): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return text + char.repeat(width - visible);
}

/**
 * Pad string to width from start, accounting for ANSI codes
 */
export function padStart(text: string, width: number, char: string = " "): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return char.repeat(width - visible) + text;
}

/**
 * Center string within width, accounting for ANSI codes
 */
export function center(text: string, width: number, char: string = " "): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  const leftPad = Math.floor((width - visible) / 2);
  const rightPad = width - visible - leftPad;
  return char.repeat(leftPad) + text + char.repeat(rightPad);
}
