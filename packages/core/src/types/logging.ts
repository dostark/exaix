/**
 * @module Logging
 * @path packages/core/src/types/logging.ts
 * @description Module for Logging.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { LogLevel, LogMetadata } from "@exaix/core";

/**
 * Metadata for a structured log entry.
 */
export interface ILogContext {
  trace_id?: string;
  request_id?: string;
  user_id?: string;
  agent_role?: string;
  portal?: string;
  session_id?: string;
  correlation_id?: string;
  operation?: string;
  step?: number;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Performance metrics associated with a log entry.
 */
export interface ILogPerformance {
  duration_ms?: number;
  memory_mb?: number;
  cpu_percent?: number;
}

/**
 * Error information in a log entry.
 */
export interface ILogError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
}

/**
 * A single structured log entry.
 */
export interface IStructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: ILogContext;
  metadata?: LogMetadata;
  error?: ILogError;
  performance?: ILogPerformance;
}

/**
 * Options for querying logs.
 */
export interface ILogQueryOptions {
  level?: LogLevel[];
  context?: Partial<ILogContext>;
  timeRange?: { start: Date; end: Date };
  limit?: number;
  includePerformance?: boolean;
  correlationId?: string;
  traceId?: string;
  agentRole?: string;
}
