/**
 * @module LogRenderer
 * @path packages/tui/src/log/renderer.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned TUI log rendering helpers for formatted single-line, detailed, and summary views.
 */

import { LogLevel } from "@exaix/core";
import type { IStructuredLogEntry } from "@exaix/core/types";
import { TuiColorName } from "../types/enums.ts";
import { ANSI, colorize, type ITuiTheme } from "@exaix/tui/helpers/colors.ts";

export interface ILogRenderOptions {
  showTimestamp: boolean;
  showContext: boolean;
  showPerformance: boolean;
  useColors: boolean;
  maxMessageLength: number;
  truncateMessages: boolean;
  theme: ITuiTheme;
}

const LOG_RENDERER_MAX_MESSAGE_LENGTH = 100;
const LOG_RENDERER_TRACE_ID_LENGTH = 8;
const LOG_RENDERER_SEPARATOR_LENGTH = 50;
const LOG_RENDERER_SEPARATOR_WIDTH = 80;
const TIME_MS_PER_SECOND = 1000;
const TIME_MS_PER_MINUTE = 60_000;
const TIME_MS_PER_HOUR = 3_600_000;

export const DEFAULT_LOG_RENDER_OPTIONS: ILogRenderOptions = {
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

export function renderContextBadges(entry: IStructuredLogEntry, options: ILogRenderOptions): string {
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
  if (entry.context.identity_id) {
    badges.push(colorize(`agent:${entry.context.identity_id}`, options.theme.success, options.theme.reset));
  }
  if (entry.context.operation) {
    badges.push(colorize(`op:${entry.context.operation}`, options.theme.warning, options.theme.reset));
  }
  if (entry.context.user_id) {
    badges.push(colorize(`user:${entry.context.user_id}`, options.theme.error, options.theme.reset));
  }

  return badges.length > 0 ? `[${badges.join(" ")}]` : "";
}

export function renderPerformanceMetrics(
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

export function renderDetailedLogEntry(entry: IStructuredLogEntry, options: Partial<ILogRenderOptions> = {}): string[] {
  const resolvedOptions = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const lines: string[] = [renderLogEntry(entry, resolvedOptions)];

  lines.push(
    colorize("─".repeat(LOG_RENDERER_SEPARATOR_WIDTH), resolvedOptions.theme.border, resolvedOptions.theme.reset),
  );

  if (Object.keys(entry.context).some((key) => entry.context[key as keyof typeof entry.context])) {
    lines.push(colorize("Context:", resolvedOptions.theme.h2, resolvedOptions.theme.reset));
    for (const [key, value] of Object.entries(entry.context)) {
      if (value) lines.push(`  ${key}: ${value}`);
    }
    lines.push("");
  }

  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    lines.push(colorize("Metadata:", resolvedOptions.theme.h2, resolvedOptions.theme.reset));
    lines.push(JSON.stringify(entry.metadata, null, 2));
    lines.push("");
  }

  if (entry.performance) {
    lines.push(colorize("Performance:", resolvedOptions.theme.h2, resolvedOptions.theme.reset));
    lines.push(JSON.stringify(entry.performance, null, 2));
    lines.push("");
  }

  if (entry.error) {
    lines.push(colorize("Error:", resolvedOptions.theme.error, resolvedOptions.theme.reset));
    lines.push(`  Name: ${entry.error.name}`);
    lines.push(`  Message: ${entry.error.message}`);
    if (entry.error.code) lines.push(`  Code: ${entry.error.code}`);
    if (entry.error.stack) {
      lines.push(colorize("  Stack:", resolvedOptions.theme.textDim, resolvedOptions.theme.reset));
      for (const line of entry.error.stack.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    lines.push("");
  }

  return lines;
}

export function renderLogSummary(entries: IStructuredLogEntry[], options: Partial<ILogRenderOptions> = {}): string[] {
  const resolvedOptions = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const lines: string[] = [];
  lines.push(colorize("Log Summary", resolvedOptions.theme.h1, resolvedOptions.theme.reset));
  lines.push(
    colorize("─".repeat(LOG_RENDERER_SEPARATOR_LENGTH), resolvedOptions.theme.border, resolvedOptions.theme.reset),
  );

  const totalEntries = entries.length;
  const levelCounts = entries.reduce((accumulator, entry) => {
    accumulator[entry.level] = (accumulator[entry.level] || 0) + 1;
    return accumulator;
  }, {} as Record<LogLevel, number>);

  lines.push(`Total Entries: ${totalEntries}`);
  for (const level of Object.values(LogLevel)) {
    const count = levelCounts[level] || 0;
    if (count > 0) {
      const levelInfo = getLevelInfo(level);
      lines.push(
        colorize(
          `  ${level}: ${count} (${((count / totalEntries) * 100).toFixed(1)}%)`,
          levelInfo.color,
          resolvedOptions.theme.reset,
        ),
      );
    }
  }

  if (entries.length > 0) {
    const timestamps = entries.map((entry) => new Date(entry.timestamp).getTime());
    const start = new Date(Math.min(...timestamps));
    const end = new Date(Math.max(...timestamps));
    const duration = end.getTime() - start.getTime();
    lines.push("");
    lines.push("Time Range:");
    lines.push(`  Start: ${start.toLocaleString()}`);
    lines.push(`  End: ${end.toLocaleString()}`);
    lines.push(`  Duration: ${formatDuration(duration)}`);
  }

  const contextStats = analyzeContext(entries);
  if (contextStats.correlationIds > 0 || contextStats.traceIds > 0 || contextStats.identityIds > 0) {
    lines.push("");
    lines.push("Context Summary:");
    if (contextStats.correlationIds > 0) lines.push(`  Correlations: ${contextStats.correlationIds}`);
    if (contextStats.traceIds > 0) lines.push(`  Traces: ${contextStats.traceIds}`);
    if (contextStats.identityIds > 0) lines.push(`  Agents: ${contextStats.identityIds}`);
  }

  return lines;
}

export function createLogLevelIndicator(level: LogLevel, theme: ITuiTheme): string {
  const levelInfo = getLevelInfo(level);
  return colorize(levelInfo.icon, levelInfo.color, theme.reset);
}

export function renderCorrelationVisualization(
  correlationId: string,
  entries: IStructuredLogEntry[],
  options: Partial<ILogRenderOptions> = {},
): string[] {
  const resolvedOptions = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const lines: string[] = [];
  lines.push(colorize(`Correlation: ${correlationId}`, resolvedOptions.theme.h1, resolvedOptions.theme.reset));
  lines.push(
    colorize("═".repeat(LOG_RENDERER_SEPARATOR_WIDTH), resolvedOptions.theme.border, resolvedOptions.theme.reset),
  );

  const sortedEntries = [...entries].sort((left, right) =>
    new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
  for (const entry of sortedEntries) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const levelIndicator = createLogLevelIndicator(entry.level, resolvedOptions.theme);
    const operation = entry.context.operation || "unknown";
    let line = `${time} ${levelIndicator} ${operation}: ${entry.message}`;
    if (entry.level === LogLevel.ERROR || entry.level === LogLevel.FATAL) {
      line = colorize(line, resolvedOptions.theme.error, resolvedOptions.theme.reset);
    }
    lines.push(line);
  }

  return lines;
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

function formatDuration(ms: number): string {
  if (ms < TIME_MS_PER_SECOND) return `${ms}ms`;
  if (ms < TIME_MS_PER_MINUTE) return `${(ms / TIME_MS_PER_SECOND).toFixed(1)}s`;
  if (ms < TIME_MS_PER_HOUR) return `${(ms / TIME_MS_PER_MINUTE).toFixed(1)}m`;
  return `${(ms / TIME_MS_PER_HOUR).toFixed(1)}h`;
}

function analyzeContext(
  entries: IStructuredLogEntry[],
): { correlationIds: number; traceIds: number; identityIds: number } {
  const correlationIds = new Set(entries.map((entry) => entry.context.correlation_id).filter(Boolean));
  const traceIds = new Set(entries.map((entry) => entry.context.trace_id).filter(Boolean));
  const identityIds = new Set(entries.map((entry) => entry.context.identity_id).filter(Boolean));
  return { correlationIds: correlationIds.size, traceIds: traceIds.size, identityIds: identityIds.size };
}
