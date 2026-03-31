/**
 * @module TuiLogOutput
 * @path src/tui/tui_log_output.ts
 * @description Implementation of StructuredLogger output that feeds entries to the TUI service for real-time display.
 * @architectural-layer TUI
 * * @related-files [src/tui/structured_log_viewer.ts]
 */

import type { IStructuredLogEntry } from "../shared/types/logging.ts";
import type { ILogOutput } from "../shared/interfaces/i_log_service.ts";
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
