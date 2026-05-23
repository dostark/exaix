/**
 * @module LogAdapter
 * @path apps/common/adapters/log_adapter.ts
 * @description Adapter implementing ILogService for TUI by wrapping StructuredLogger.
 * @architectural-layer Services
 * @ungrounded
 * @related-files ["packages/core/src/logger/structured_logger.ts", apps/tui/src/structured_log_service.ts]
 */

import type { ILogOutput, ILogService } from "@exaix/core/types";
import { FileOutput, ObservableOutput } from "@exaix/core/logger";
import type { IStructuredLogEntry, LogQueryOptions } from "@exaix/core/types";
import { join } from "@std/path";

interface LoggerWithOutputs {
  getOutputs(): ILogOutput[];
}

/**
 * Adapter that provides log querying and subscription capabilities for the TUI,
 * delegating to the core StructuredLogger service.
 */
export class LogServiceAdapter implements ILogService {
  constructor(private logger: LoggerWithOutputs) {}

  /**
   * Get logs based on query options by reading from log files.
   */
  async getStructuredLogs(options: LogQueryOptions): Promise<IStructuredLogEntry[]> {
    const fileOutput = this.logger.getOutputs().find((o) => o instanceof FileOutput) as FileOutput;
    if (!fileOutput) return [];

    const logPath = fileOutput.getBasePath();
    const logs: IStructuredLogEntry[] = [];
    const limit = options.limit || 100;

    try {
      const filesToRead = await this.getLogFiles(logPath);

      for (const file of filesToRead) {
        if (logs.length >= limit) break;
        await this.processLogFile(file, options, logs, limit);
      }
    } catch (error) {
      console.error("Error reading structured logs:", error);
    }

    return logs;
  }

  private async getLogFiles(logPath: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const stat = await Deno.stat(logPath);
      if (stat.isDirectory) {
        for await (const entry of Deno.readDir(logPath)) {
          if (entry.isFile && entry.name.endsWith(".jsonl")) {
            files.push(join(logPath, entry.name));
          }
        }
      } else {
        files.push(logPath);
      }
    } catch {
      return [];
    }
    return files.sort().reverse();
  }

  private async processLogFile(
    file: string,
    options: LogQueryOptions,
    logs: IStructuredLogEntry[],
    limit: number,
  ): Promise<void> {
    const content = await Deno.readTextFile(file);
    const lines = content.trim().split("\n").reverse();

    for (const line of lines) {
      if (!line) continue;
      if (logs.length >= limit) break;

      try {
        const entry = JSON.parse(line) as IStructuredLogEntry;
        if (this.matchesFilters(entry, options)) {
          logs.push(entry);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  private matchesFilters(entry: IStructuredLogEntry, options: LogQueryOptions): boolean {
    if (options.level && !options.level.includes(entry.level)) return false;
    if (options.traceId && entry.context.trace_id !== options.traceId) return false;
    if (options.correlationId && entry.context.correlation_id !== options.correlationId) return false;
    if (options.identityId && entry.context.identity_id !== options.identityId) return false;
    return true;
  }

  /**
   * Subscribe to new log entries.
   */
  subscribeToLogs(callback: (entry: IStructuredLogEntry) => void): () => void {
    const observable = this.logger.getOutputs().find((o) => o instanceof ObservableOutput) as
      | ObservableOutput
      | undefined;

    if (!observable) {
      console.warn("ObservableOutput not found in logger, log subscription will not work.");
      return () => {};
    }

    return observable.subscribe(callback);
  }

  /**
   * Get logs by correlation ID.
   */
  async getLogsByCorrelationId(correlationId: string): Promise<IStructuredLogEntry[]> {
    return await this.getStructuredLogs({ correlationId });
  }

  /**
   * Get logs by trace ID (context.trace_id).
   */
  async getLogsByTraceId(traceId: string): Promise<IStructuredLogEntry[]> {
    return await this.getStructuredLogs({ traceId });
  }

  /**
   * Get logs by agent ID.
   */
  async getLogsByAgentId(identityId: string): Promise<IStructuredLogEntry[]> {
    return await this.getStructuredLogs({ identityId });
  }

  /**
   * Export logs to a JSONL file.
   */
  async exportLogs(filename: string, entries: IStructuredLogEntry[]): Promise<void> {
    const content = entries.map((e) => JSON.stringify(e)).join("\n");
    await Deno.writeTextFile(filename, content);
  }
}
