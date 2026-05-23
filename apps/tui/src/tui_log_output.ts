/**
 * @module TuiLogOutput
 * @path apps/tui/src/tui_log_output.ts
 * @description Implementation of StructuredLogger output that feeds entries to the TUI service for real-time display.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files [apps/tui/src/structured_log_viewer.ts]
 */

import type { IStructuredLogEntry } from "@exaix/core/types";
import type { ILogOutput } from "@exaix/core/types";
import type { StructuredLoggerService } from "./structured_log_service.ts";

/**
 * ILogOutput implementation that feeds entries to StructuredLoggerService
 */
export class TuiLogOutput implements ILogOutput {
  constructor(private logService: StructuredLoggerService) {}

  write(entry: IStructuredLogEntry): void {
    this.logService.addLogEntry(entry);
  }
}

/**
 * Factory function to create TuiLogOutput
 */
export function createTuiLogOutput(logService: StructuredLoggerService): TuiLogOutput {
  return new TuiLogOutput(logService);
}
