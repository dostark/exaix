/**
 * @module IDisplayService
 * @path src/shared/interfaces/i_display_service.ts
 * @description Interface for CLI/TUI display services (wrapping EventLogger).
 * @architectural-layer Shared
 * * @related-files [src/services/adapters/display_adapter.ts, src/cli/cli_context.ts, src/cli/commands/blueprint_commands.ts]
 */

import type { LogMetadata } from "@exaix/core";

export interface IDisplayService {
  /** Output info level message */
  info(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;

  /** Output warn level message */
  warn(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;

  /** Output error level message */
  error(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;

  /** Output debug level message */
  debug(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;

  /** Output fatal level message */
  fatal(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;
}
