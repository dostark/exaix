/**
 * @module LogRenderer
 * @path packages/tui/src/log/renderer.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned TUI log rendering helpers for formatted single-line, detailed, and summary views.
 */

import { LogLevel } from "@exaix/core";
import { LOG_RENDERER_MAX_MESSAGE_LENGTH, LOG_RENDERER_TRACE_ID_LENGTH } from "@exaix/core";
import type { IStructuredLogEntry } from "@exaix/core/types";
import { TuiColorName } from "../types/enums.ts";
import { ANSI, colorize, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";

interface ILogRenderOptions {
  showTimestamp: boolean;
  showContext: boolean;
  showPerformance: boolean;
  useColors: boolean;
  maxMessageLength: number;
  truncateMessages: boolean;
  theme: ITuiTheme;
}

const DEFAULT_LOG_RENDER_OPTIONS: ILogRenderOptions = {
  showTimestamp: true,
  showContext: true,
  showPerformance: true,
  useColors: true,
  maxMessageLength: LOG_RENDERER_MAX_MESSAGE_LENGTH,
  truncateMessages: true,
  theme: {
    primary: ANSI.cyan,
    secondary: ANSI.blue,
    accent: ANSI.magenta,
    border: ANSI.brightBlack,
    borderActive: ANSI.cyan,
    text: "",
    textDim: ANSI.dim,
    textBold: ANSI.bold,
    success: ANSI.green,
    warning: ANSI.yellow,
    error: ANSI.red,
    info: ANSI.blue,
    treeExpanded: ANSI.cyan,
    treeCollapsed: ANSI.brightBlack,
    treeLeaf: ANSI.brightBlack,
    treeSelected: `${ANSI.inverse}${ANSI.cyan}`,
    h1: `${ANSI.bold}${ANSI.cyan}`,
    h2: `${ANSI.bold}${ANSI.blue}`,
    h3: `${ANSI.bold}${ANSI.magenta}`,
    code: ANSI.yellow,
    codeBlock: `${ANSI.dim}${ANSI.yellow}`,
    categoryPattern: ANSI.blue,
    categoryDecision: ANSI.green,
    categoryTroubleshooting: ANSI.red,
    categoryInsight: ANSI.magenta,
    confidenceHigh: ANSI.green,
    confidenceMedium: ANSI.yellow,
    confidenceLow: ANSI.red,
    statusActive: ANSI.cyan,
    statusPending: ANSI.yellow,
    statusCompleted: ANSI.green,
    statusFailed: ANSI.red,
    textInverted: ANSI.inverse,
    link: `${ANSI.underline}${ANSI.blue}`,
    spinner: ANSI.cyan,
    selection: ANSI.inverse,
    selectionText: ANSI.bold,
    reset: ANSI.reset,
  },
};

export function renderLogEntry(entry: IStructuredLogEntry, options: Partial<ILogRenderOptions> = {}): string {
  const resolvedOptions = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const parts: string[] = [];

  if (resolvedOptions.showTimestamp) {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    parts.push(colorize(timestamp, resolvedOptions.theme.textDim, resolvedOptions.theme.reset));
  }

  const levelInfo = getLevelInfo(entry.level);
  parts.push(
    colorize(`${levelInfo.icon} ${entry.level.toUpperCase().padEnd(5)}`, levelInfo.color, resolvedOptions.theme.reset),
  );

  if (resolvedOptions.showContext) {
    const contextBadges = renderContextBadges(entry, resolvedOptions);
    if (contextBadges) parts.push(contextBadges);
  }

  let message = entry.message;
  if (resolvedOptions.truncateMessages && message.length > resolvedOptions.maxMessageLength) {
    message = `${message.substring(0, resolvedOptions.maxMessageLength - 3)}...`;
  }
  parts.push(message);

  if (resolvedOptions.showPerformance && entry.performance) {
    const performance = renderPerformanceMetrics(entry.performance, resolvedOptions);
    if (performance) {
      parts.push(colorize(performance, resolvedOptions.theme.secondary, resolvedOptions.theme.reset));
    }
  }

  return parts.join(" ");
}

function renderContextBadges(entry: IStructuredLogEntry, options: ILogRenderOptions): string {
  const badges: string[] = [];

  if (entry.context.trace_id) {
    badges.push(
      colorize(
        `trace:${entry.context.trace_id.slice(0, LOG_RENDERER_TRACE_ID_LENGTH)}`,
        options.theme.primary,
        options.theme.reset,
      ),
    );
  }
  if (entry.context.correlation_id) {
    badges.push(
      colorize(
        `corr:${entry.context.correlation_id.slice(0, LOG_RENDERER_TRACE_ID_LENGTH)}`,
        options.theme.secondary,
        options.theme.reset,
      ),
    );
  }
  if (entry.context.agent_role) {
    badges.push(colorize(`agent:${entry.context.agent_role}`, options.theme.success, options.theme.reset));
  }
  if (entry.context.operation) {
    badges.push(colorize(`op:${entry.context.operation}`, options.theme.warning, options.theme.reset));
  }
  if (entry.context.user_id) {
    badges.push(colorize(`user:${entry.context.user_id}`, options.theme.error, options.theme.reset));
  }

  return badges.length > 0 ? `[${badges.join(" ")}]` : "";
}

function renderPerformanceMetrics(
  performance: IStructuredLogEntry["performance"],
  _options: ILogRenderOptions,
): string {
  if (!performance) return "";

  const metrics: string[] = [];
  if (performance.duration_ms !== undefined) metrics.push(`${performance.duration_ms}ms`);
  if (performance.memory_mb !== undefined) metrics.push(`${performance.memory_mb}MB`);
  if (performance.cpu_percent !== undefined) metrics.push(`${performance.cpu_percent}%`);
  return metrics.length > 0 ? `(${metrics.join(", ")})` : "";
}

function getLevelInfo(level: LogLevel): { icon: string; color: string } {
  switch (level) {
    case LogLevel.FATAL:
      return { icon: "💥", color: TuiColorName.MAGENTA };
    case LogLevel.ERROR:
      return { icon: "❌", color: TuiColorName.RED };
    case LogLevel.WARN:
      return { icon: "⚠️", color: TuiColorName.YELLOW };
    case LogLevel.INFO:
      return { icon: "ℹ️", color: TuiColorName.BLUE };
    case LogLevel.DEBUG:
      return { icon: "🔍", color: TuiColorName.GRAY };
    default:
      return { icon: "📋", color: TuiColorName.WHITE };
  }
}
