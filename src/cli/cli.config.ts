/**
 * @module CLIConfig
 * @path src/cli/cli.config.ts
 * @description Defines user-tunable constants and default settings for Exaix CLI commands, including limits, formatting, and priorities.
 * @architectural-layer CLI
 * @related-files [src/cli/main.ts]
 */

import { DEFAULT_AGENT_MODEL, SHARED_PRIORITY_ICONS } from "@exaix/core";
import { RequestPriority } from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";

export const MEMORY_COMMAND_DEFAULTS = {
  LIMIT: 20,
  FORMAT: UIOutputFormat.TABLE,
  PROJECT_PADDING: 10,
  PORTAL_PADDING: 15,
  TITLE_LENGTH: 30,
  TRACE_ID_LENGTH: 8,
  STATUS_PADDING: 9,
  TIMESTAMP_LENGTH: 19,
  PROJECT_NAME_PADDING: 20,
  PATTERNS_PADDING: 8,
  DECISIONS_PADDING: 9,
};

export const PRIORITY_ICONS: Record<string, string> = {
  critical: SHARED_PRIORITY_ICONS.critical,
  high: SHARED_PRIORITY_ICONS.high,
  normal: SHARED_PRIORITY_ICONS.normal,
  low: SHARED_PRIORITY_ICONS.low,
  default: SHARED_PRIORITY_ICONS.default,
};

export const CLI_DEFAULTS = {
  PRIORITY: RequestPriority.NORMAL,
  AGENT: DEFAULT_AGENT_MODEL,
  LOG_LINES: 50,
  DAEMON_CHECK_INTERVAL_MS: 50,
};

export const CLI_OUTPUT_FORMATS = {
  TABLE: UIOutputFormat.TABLE,
  JSON: UIOutputFormat.JSON,
  TEXT: "text",
};
