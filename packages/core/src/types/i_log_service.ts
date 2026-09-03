/**
 * @module IlogService
 * @path packages/core/src/types/i_log_service.ts
 * @description Module for IlogService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { LogMetadata } from "@exaix/core";
import type { ILogContext, ILogQueryOptions, IStructuredLogEntry } from "@exaix/core/types";

/**
 * Core logger interface for emitting logs.
 */
export interface ILogger {
  setContext(context: Partial<ILogContext>): void;
  child(additionalContext: Partial<ILogContext>): ILogger;

  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, error?: Error, metadata?: LogMetadata): void;
  fatal(message: string, error?: Error, metadata?: LogMetadata): void;

  time<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: LogMetadata,
  ): Promise<T>;
}

/**
 * Interface for log output destinations.
 */
export interface ILogOutput {
  write(entry: IStructuredLogEntry): void | Promise<void>;
}

/** Alias for ILogger for compatibility */
export type IStructuredLogger = ILogger;

/**
 * Service interface for querying and managing logs (e.g., for TUI).
 */
export interface ILogService {
  /**
   * Get logs based on query options.
   */
  getStructuredLogs(options: ILogQueryOptions): Promise<IStructuredLogEntry[]>;

  /**
   * Subscribe to new log entries as they arrive.
   */
  subscribeToLogs(callback: (entry: IStructuredLogEntry) => void): () => void;

  /**
   * Get logs by correlation ID.
   */
  getLogsByCorrelationId(correlationId: string): Promise<IStructuredLogEntry[]>;

  /**
   * Get logs by trace ID.
   */
  getLogsByTraceId(traceId: string): Promise<IStructuredLogEntry[]>;

  /**
   * Get logs by agent ID.
   */
  getLogsByAgentId(agentRole: string): Promise<IStructuredLogEntry[]>;

  /**
   * Export logs to a JSONL file.
   */
  exportLogs(filename: string, entries: IStructuredLogEntry[]): Promise<void>;
}

/** Alias for ILogService for compatibility */
export type IStructuredLoggerService = ILogService;
