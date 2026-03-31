/**
 * @module TuiConfig
 * @path src/tui/tui.config.ts
 * @description TUI configuration and constants, including icons, colors for log entries, and refresh intervals.
 * @architectural-layer TUI
 * * @related-files [src/tui/tui_dashboard.ts]
 */

import { TUI_LOG_ICONS } from "./helpers/constants.ts";

export const LOG_ICONS: Record<string, string> = {
  "request_created": TUI_LOG_ICONS["request_created"],
  "request.created": TUI_LOG_ICONS["request.created"],
  "plan_approved": TUI_LOG_ICONS["plan_approved"],
  "plan.approved": TUI_LOG_ICONS["plan.approved"],
  "plan.rejected": TUI_LOG_ICONS["plan.rejected"],
  "execution_started": TUI_LOG_ICONS["execution_started"],
  "execution.started": TUI_LOG_ICONS["execution.started"],
  "execution_completed": TUI_LOG_ICONS["execution_completed"],
  "execution.completed": TUI_LOG_ICONS["execution.completed"],
  "execution_failed": TUI_LOG_ICONS["execution_failed"],
  "execution.failed": TUI_LOG_ICONS["execution.failed"],
  "error": TUI_LOG_ICONS["error"],
  "default": TUI_LOG_ICONS["default"],
};

export const LOG_COLORS: Record<string, string> = {
  "request_created": "green",
  "request.created": "green",
  "plan_approved": "blue",
  "plan.approved": "blue",
  "plan.rejected": "red",
  "execution_started": "yellow",
  "execution.started": "yellow",
  "execution_completed": "green",
  "execution.completed": "green",
  "execution_failed": "red",
  "execution.failed": "red",
  "error": "red",
  "unknown": "white",
  "default": "white",
};

export const MONITOR_REFRESH_INTERVAL_MS = 1000;
export const MONITOR_AUTO_REFRESH_INTERVAL_MS = 5000;
export const MEMORY_STALE_MS = 30000;
