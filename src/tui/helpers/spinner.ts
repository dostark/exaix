/**
 * @module Spinner
 * @path src/tui/helpers/spinner.ts
 * @description TUI spinner and animation utilities for asynchronous operations.
 * @architectural-layer Helpers
 * * @related-files [src/helpers/status_bar.ts]
 */

import { colorize, getTheme } from "./colors.ts";
import { SpinnerStyle } from "@exaix/core";
import { SECONDS_PER_HOUR } from "@exaix/core";

export interface ISpinnerConfig {
  style: SpinnerStyle;
  frames: string[];
  interval: number; // ms
}

// ===== Spinner Definitions =====

export const SPINNERS: Record<SpinnerStyle, ISpinnerConfig> = {
  [SpinnerStyle.DOTS]: {
    style: SpinnerStyle.DOTS,
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    interval: 80,
  },
  [SpinnerStyle.BRAILLE]: {
    style: SpinnerStyle.BRAILLE,
    frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
    interval: 100,
  },
  [SpinnerStyle.LINE]: {
    style: SpinnerStyle.LINE,
    frames: ["-", "\\", "|", "/"],
    interval: 100,
  },
  [SpinnerStyle.ARC]: {
    style: SpinnerStyle.ARC,
    frames: ["◜", "◠", "◝", "◞", "◡", "◟"],
    interval: 100,
  },
  [SpinnerStyle.BOUNCE]: {
    style: SpinnerStyle.BOUNCE,
    frames: ["⠁", "⠂", "⠄", "⠂"],
    interval: 120,
  },
  [SpinnerStyle.PULSE]: {
    style: SpinnerStyle.PULSE,
    frames: ["○", "◔", "◑", "◕", "●", "◕", "◑", "◔"],
    interval: 120,
  },
};

// ===== Spinner State =====

export interface SpinnerState {
  active: boolean;
  frame: number;
  message: string;
  startTime: number;
}

/**
 * Create a new spinner state
 */
export function createSpinnerState(message: string = ""): SpinnerState {
  return {
    active: false,
    frame: 0,
    message,
    startTime: 0,
  };
}

/**
 * Start a spinner
 */
export function startSpinner(state: SpinnerState, message?: string): SpinnerState {
  return {
    ...state,
    active: true,
    frame: 0,
    message: message ?? state.message,
    startTime: Date.now(),
  };
}

/**
 * Stop a spinner
 */
export function stopSpinner(state: SpinnerState): SpinnerState {
  return {
    ...state,
    active: false,
  };
}

/**
 * Advance spinner to next frame
 */
export function nextFrame(state: SpinnerState): SpinnerState {
  return {
    ...state,
    frame: state.frame + 1,
  };
}

// ===== Spinner Rendering =====

/**
 * Render a spinner frame
 */
export function renderSpinnerFrame(
  frame: number,
  style: SpinnerStyle = SpinnerStyle.DOTS,
): string {
  const spinner = SPINNERS[style];
  return spinner.frames[frame % spinner.frames.length];
}

/**
 * Render spinner with message
 */
export function renderSpinner(
  state: SpinnerState,
  options: {
    style?: SpinnerStyle;
    useColors?: boolean;
    showElapsed?: boolean;
  } = {},
): string {
  const { style = SpinnerStyle.DOTS, useColors = true, showElapsed = false } = options;
  const theme = getTheme(useColors);

  if (!state.active) return "";

  const frame = renderSpinnerFrame(state.frame, style);
  const coloredFrame = colorize(frame, theme.accent, theme.reset);

  let result = `${coloredFrame} ${state.message}`;

  if (showElapsed && state.startTime > 0) {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const elapsedStr = colorize(`(${elapsed}s)`, theme.textDim, theme.reset);
    result += ` ${elapsedStr}`;
  }

  return result;
}

// ===== Progress Bar =====

export interface ProgressState {
  current: number;
  total: number;
  message: string;
  startTime: number;
}

/**
 * Create a new progress state
 */
export function createProgressState(total: number, message: string = ""): ProgressState {
  return {
    current: 0,
    total,
    message,
    startTime: Date.now(),
  };
}

/**
 * Update progress
 */
export function updateProgress(state: ProgressState, current: number, message?: string): ProgressState {
  return {
    ...state,
    current: Math.min(current, state.total),
    message: message ?? state.message,
  };
}

/**
 * Increment progress by one
 */
export function incrementProgress(state: ProgressState): ProgressState {
  return updateProgress(state, state.current + 1);
}

/**
 * Render a progress bar
 */
export function renderProgressBar(
  state: ProgressState,
  options: {
    width?: number;
    useColors?: boolean;
    showPercent?: boolean;
    showCount?: boolean;
    showEta?: boolean;
    filledChar?: string;
    emptyChar?: string;
  } = {},
): string {
  const {
    width = 20,
    useColors = true,
    showPercent = true,
    showCount = false,
    showEta = false,
    filledChar = "█",
    emptyChar = "░",
  } = options;

  const theme = getTheme(useColors);
  const percent = state.total > 0 ? state.current / state.total : 0;
  const filled = Math.round(width * Math.min(1, percent));
  const empty = width - filled;

  // Build the bar
  const filledBar = colorize(filledChar.repeat(filled), theme.success, theme.reset);
  const emptyBar = colorize(emptyChar.repeat(empty), theme.textDim, theme.reset);
  const bar = `[${filledBar}${emptyBar}]`;

  const parts: string[] = [bar];

  // Add percentage
  if (showPercent) {
    const percentStr = `${Math.round(percent * 100)}%`;
    parts.push(percentStr);
  }

  // Add count
  if (showCount) {
    const countStr = colorize(`(${state.current}/${state.total})`, theme.textDim, theme.reset);
    parts.push(countStr);
  }

  // Add ETA
  if (showEta && state.current > 0 && state.current < state.total) {
    const elapsed = (Date.now() - state.startTime) / 1000;
    const rate = state.current / elapsed;
    const remaining = (state.total - state.current) / rate;
    const etaStr = colorize(`~${formatDuration(remaining)}`, theme.textDim, theme.reset);
    parts.push(etaStr);
  }

  // Add message
  if (state.message) {
    parts.push(state.message);
  }

  return parts.join(" ");
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < SECONDS_PER_HOUR) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const mins = Math.floor((seconds % SECONDS_PER_HOUR) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ===== Animated Indicators =====

/**
 * Render a pulsing dot indicator
 */
export function renderPulsingDot(
  frame: number,
  useColors: boolean = true,
): string {
  const frames = ["○", "◔", "◑", "◕", "●", "◕", "◑", "◔"];
  const theme = getTheme(useColors);
  const char = frames[frame % frames.length];
  return colorize(char, theme.accent, theme.reset);
}

/**
 * Render activity indicator (for background processes)
 */
export function renderActivityIndicator(
  active: boolean,
  frame: number,
  useColors: boolean = true,
): string {
  const theme = getTheme(useColors);

  if (!active) {
    return colorize("○", theme.textDim, theme.reset);
  }

  return renderPulsingDot(frame, useColors);
}

// ===== Loading States =====

export interface LoadingState {
  isLoading: boolean;
  message: string;
  spinner: SpinnerState;
  progress?: ProgressState;
}

/**
 * Create a loading state
 */
export function createLoadingState(): LoadingState {
  return {
    isLoading: false,
    message: "",
    spinner: createSpinnerState(),
    progress: undefined,
  };
}

/**
 * Start loading with a message
 */
export function startLoading(state: LoadingState, message: string): LoadingState {
  return {
    ...state,
    isLoading: true,
    message,
    spinner: startSpinner(state.spinner, message),
    progress: undefined,
  };
}

/**
 * Start loading with progress
 */
export function startLoadingWithProgress(
  state: LoadingState,
  message: string,
  total: number,
): LoadingState {
  return {
    ...state,
    isLoading: true,
    message,
    spinner: startSpinner(state.spinner, message),
    progress: createProgressState(total, message),
  };
}

/**
 * Stop loading
 */
export function stopLoading(state: LoadingState): LoadingState {
  return {
    ...state,
    isLoading: false,
    message: "",
    spinner: stopSpinner(state.spinner),
    progress: undefined,
  };
}

/**
 * Render loading state
 */
export function renderLoadingState(
  state: LoadingState,
  options: { useColors?: boolean; width?: number } = {},
): string {
  const { useColors = true, width = 30 } = options;

  if (!state.isLoading) return "";

  // If we have progress, show progress bar
  if (state.progress) {
    return renderProgressBar(state.progress, {
      width,
      useColors,
      showPercent: true,
      showEta: true,
    });
  }

  // Otherwise show spinner
  return renderSpinner(state.spinner, {
    useColors,
    showElapsed: true,
  });
}
