/**
 * @module LogRenderer
 * @path src/tui/log_renderer.ts
 * @description Enhanced log visualization utilities for the TUI, providing colored output, rich context badges, and performance metrics formatting.
 * @architectural-layer TUI
 * * @related-files [src/tui/monitor_view.ts, src/tui/structured_log_viewer.ts]
 */

import {
  CLI_SEPARATOR_WIDE,
  LOG_RENDERER_MAX_MESSAGE_LENGTH,
  LOG_RENDERER_SEPARATOR_LENGTH,
  LOG_RENDERER_TRACE_ID_LENGTH,
  TIME_MS_PER_HOUR,
  TIME_MS_PER_MINUTE,
  TIME_MS_PER_SECOND,
} from "../shared/constants.ts";
import { colorize, type ITuiTheme } from "./helpers/colors.ts";
import type { IStructuredLogEntry } from "../shared/types/logging.ts";
import { LogLevel, TuiColorName } from "../shared/enums.ts";

/**
 * Log rendering options
 */
export interface ILogRenderOptions {
  /** Whether to show timestamps */
  showTimestamp: boolean;
  /** Whether to show context badges */
  showContext: boolean;
  /** Whether to show performance metrics */
  showPerformance: boolean;
  /** Whether to use colors */
  useColors: boolean;
  /** Maximum message length */
  maxMessageLength: number;
  /** Whether to truncate long messages */
  truncateMessages: boolean;
  /** Theme for coloring */
  theme: ITuiTheme;
}

/**
 * Default rendering options
 */
export const DEFAULT_LOG_RENDER_OPTIONS: ILogRenderOptions = {
  showTimestamp: true,
  showContext: true,
  showPerformance: true,
  useColors: true,
  maxMessageLength: LOG_RENDERER_MAX_MESSAGE_LENGTH,
  truncateMessages: true,
  theme: {
    primary: "\x1b[36m", // cyan
    secondary: "\x1b[34m", // blue
    accent: "\x1b[35m", // magenta
    border: "\x1b[90m", // bright black
    borderActive: "\x1b[36m", // cyan
    text: "",
    textDim: "\x1b[2m", // dim
    textBold: "\x1b[1m", // bold
    success: "\x1b[32m", // green
    warning: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    info: "\x1b[34m", // blue
    treeExpanded: "\x1b[36m", // cyan
    treeCollapsed: "\x1b[90m", // bright black
    treeLeaf: "\x1b[90m", // bright black
    treeSelected: "\x1b[7m\x1b[36m", // inverse + cyan
    h1: "\x1b[1m\x1b[36m", // bold + cyan
    h2: "\x1b[1m\x1b[34m", // bold + blue
    h3: "\x1b[1m\x1b[35m", // bold + magenta
    code: "\x1b[33m", // yellow
    codeBlock: "\x1b[2m\x1b[33m", // dim + yellow
    categoryPattern: "\x1b[34m", // blue
    categoryDecision: "\x1b[32m", // green
    categoryTroubleshooting: "\x1b[31m", // red
    categoryInsight: "\x1b[35m", // magenta
    confidenceHigh: "\x1b[32m", // green
    confidenceMedium: "\x1b[33m", // yellow
    confidenceLow: "\x1b[31m", // red
    statusActive: "\x1b[36m", // cyan
    statusPending: "\x1b[33m", // yellow
    statusCompleted: "\x1b[32m", // green
    statusFailed: "\x1b[31m", // red
    textInverted: "\x1b[7m",
    link: "\x1b[4m\x1b[34m",
    spinner: "\x1b[36m",
    selection: "\x1b[7m",
    selectionText: "\x1b[1m",
    reset: "\x1b[0m",
  },
};

/**
 * Render a single log entry as a formatted string
 */
export function renderLogEntry(entry: IStructuredLogEntry, options: Partial<ILogRenderOptions> = {}): string {
  const opts = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const parts: string[] = [];

  // Timestamp
  if (opts.showTimestamp) {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    parts.push(colorize(timestamp, opts.theme.textDim, opts.theme.reset));
  }

  // Level with color and icon
  const levelInfo = getLevelInfo(entry.level);
  const levelStr = `${levelInfo.icon} ${entry.level.toUpperCase().padEnd(5)}`;
  parts.push(colorize(levelStr, levelInfo.color, opts.theme.reset));

  // Context badges
  if (opts.showContext) {
    const contextBadges = renderContextBadges(entry, opts);
    if (contextBadges) {
      parts.push(contextBadges);
    }
  }

  // Message
  let message = entry.message;
  if (opts.truncateMessages && message.length > opts.maxMessageLength) {
    message = message.substring(0, opts.maxMessageLength - 3) + "...";
  }
  parts.push(message);

  // Performance metrics
  if (opts.showPerformance && entry.performance) {
    const perfStr = renderPerformanceMetrics(entry.performance, opts);
    if (perfStr) {
      parts.push(colorize(perfStr, opts.theme.secondary, opts.theme.reset));
    }
  }

  return parts.join(" ");
}

/**
 * Render context badges for a log entry
 */
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
        `
      corr:${entry.context.correlation_id.slice(0, LOG_RENDERER_TRACE_ID_LENGTH)}`,
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

/**
 * Render performance metrics
 */
export function renderPerformanceMetrics(
  performance: IStructuredLogEntry["performance"],
  _options: ILogRenderOptions,
): string {
  if (!performance) return "";

  const metrics: string[] = [];

  if (performance.duration_ms !== undefined) {
    metrics.push(`${performance.duration_ms}ms`);
  }

  if (performance.memory_mb !== undefined) {
    metrics.push(`${performance.memory_mb}MB`);
  }

  if (performance.cpu_percent !== undefined) {
    metrics.push(`${performance.cpu_percent}%`);
  }

  return metrics.length > 0 ? `(${metrics.join(", ")})` : "";
}

/**
 * Render detailed log entry (multi-line)
 */
export function renderDetailedLogEntry(entry: IStructuredLogEntry, options: Partial<ILogRenderOptions> = {}): string[] {
  const opts = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const lines: string[] = [];

  // Header line
  lines.push(renderLogEntry(entry, opts));

  // Separator
  lines.push(colorize("─".repeat(CLI_SEPARATOR_WIDE), opts.theme.border, opts.theme.reset));

  // Context details()()
  if (Object.keys(entry.context).some((key) => entry.context[key as keyof typeof entry.context])) {
    lines.push(colorize("Context:", opts.theme.h2, opts.theme.reset));
    for (const [key, value] of Object.entries(entry.context)) {
      if (value) {
        lines.push(`  ${key}: ${value}`);
      }
    }
    lines.push("");
  }

  // Metadata
  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    lines.push(colorize("Metadata:", opts.theme.h2, opts.theme.reset));
    lines.push(JSON.stringify(entry.metadata, null, 2));
    lines.push("");
  }

  // Performance
  if (entry.performance) {
    lines.push(colorize("Performance:", opts.theme.h2, opts.theme.reset));
    lines.push(JSON.stringify(entry.performance, null, 2));
    lines.push("");
  }

  // Error details
  if (entry.error) {
    lines.push(colorize("Error:", opts.theme.error, opts.theme.reset));
    lines.push(`  Name: ${entry.error.name}`);
    lines.push(`  Message: ${entry.error.message}`);
    if (entry.error.code) {
      lines.push(`  Code: ${entry.error.code}`);
    }
    if (entry.error.stack) {
      lines.push(colorize("  Stack:", opts.theme.textDim, opts.theme.reset));
      const stackLines = entry.error.stack.split("\n");
      for (const line of stackLines) {
        lines.push(`    ${line}`);
      }
    }
    lines.push("");
  }

  return lines;
}

/**
 * Render log summary statistics
 */
export function renderLogSummary(entries: IStructuredLogEntry[], options: Partial<ILogRenderOptions> = {}): string[] {
  const opts = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push(colorize("Log Summary", opts.theme.h1, opts.theme.reset));
  lines.push(colorize("─".repeat(LOG_RENDERER_SEPARATOR_LENGTH), opts.theme.border, opts.theme.reset));

  // Basic stats
  const totalEntries = entries.length;
  const levelCounts = entries.reduce((acc, entry) => {
    acc[entry.level] = (acc[entry.level] || 0) + 1;
    return acc;
  }, {} as Record<LogLevel, number>);

  lines.push(`Total Entries: ${totalEntries}`);

  for (const level of Object.values(LogLevel)) {
    const count = levelCounts[level] || 0;
    if (count > 0) {
      const levelInfo = getLevelInfo(level);
      const percentage = ((count / totalEntries) * 100).toFixed(1);
      lines.push(colorize(`  ${level}: ${count} (${percentage}%)`, levelInfo.color, opts.theme.reset));
    }
  }

  // Time range
  if (entries.length > 0) {
    const timestamps = entries.map((e) => new Date(e.timestamp));
    const start = new Date(Math.min(...timestamps.map((t) => t.getTime())));
    const end = new Date(Math.max(...timestamps.map((t) => t.getTime())));
    const duration = end.getTime() - start.getTime();

    lines.push("");
    lines.push("Time Range:");
    lines.push(`  Start: ${start.toLocaleString()}`);
    lines.push(`  End: ${end.toLocaleString()}`);
    lines.push(`  Duration: ${formatDuration(duration)}`);
  }

  // Context summary
  const contextStats = analyzeContext(entries);
  if (contextStats.correlationIds > 0 || contextStats.traceIds > 0 || contextStats.identityIds > 0) {
    lines.push("");
    lines.push("Context Summary:");
    if (contextStats.correlationIds > 0) {
      lines.push(`  Correlations: ${contextStats.correlationIds}`);
    }
    if (contextStats.traceIds > 0) {
      lines.push(`  Traces: ${contextStats.traceIds}`);
    }
    if (contextStats.identityIds > 0) {
      lines.push(`  Agents: ${contextStats.identityIds}`);
    }
  }

  return lines;
}

/**
 * Get level-specific display information
 */
function getLevelInfo(level: LogLevel): { icon: string; color: string } {
  switch (level as LogLevel) {
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

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < TIME_MS_PER_SECOND) return `${ms}ms`;
  if (ms < TIME_MS_PER_MINUTE) return `${(ms / TIME_MS_PER_SECOND).toFixed(1)}s`;
  if (ms < TIME_MS_PER_HOUR) return `${(ms / TIME_MS_PER_MINUTE).toFixed(1)}m`;
  return `${(ms / TIME_MS_PER_HOUR).toFixed(1)}h`;
}

/**
 * Analyze context statistics
 */
function analyzeContext(entries: IStructuredLogEntry[]): {
  correlationIds: number;
  traceIds: number;
  identityIds: number;
} {
  const correlationIds = new Set(entries.map((e) => e.context.correlation_id).filter(Boolean));
  const traceIds = new Set(entries.map((e) => e.context.trace_id).filter(Boolean));
  const identityIds = new Set(entries.map((e) => e.context.identity_id).filter(Boolean));

  return {
    correlationIds: correlationIds.size,
    traceIds: traceIds.size,
    identityIds: identityIds.size,
  };
}

/**
 * Create a colorized log level indicator
 */
export function createLogLevelIndicator(level: LogLevel, theme: ITuiTheme): string {
  const levelInfo = getLevelInfo(level);
  return colorize(levelInfo.icon, levelInfo.color, theme.reset);
}

/**
 * Render log correlation visualization
 */
export function renderCorrelationVisualization(
  correlationId: string,
  entries: IStructuredLogEntry[],
  options: Partial<ILogRenderOptions> = {},
): string[] {
  const opts = { ...DEFAULT_LOG_RENDER_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push(colorize(`Correlation: ${correlationId}`, opts.theme.h1, opts.theme.reset));
  lines.push(colorize("═".repeat(CLI_SEPARATOR_WIDE), opts.theme.border, opts.theme.reset));

  // Sort by timestamp
  const sortedEntries = entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const entry of sortedEntries) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const levelIndicator = createLogLevelIndicator(entry.level, opts.theme);
    const operation = entry.context.operation || "unknown";

    let line = `${time} ${levelIndicator} ${operation}: ${entry.message}`;

    // Highlight errors
    if (entry.level === LogLevel.ERROR || entry.level === LogLevel.FATAL) {
      line = colorize(line, opts.theme.error, opts.theme.reset);
    }

    lines.push(line);
  }

  return lines;
}
