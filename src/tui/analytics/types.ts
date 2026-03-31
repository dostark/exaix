/**
 * @module AnalyticsTypes
 * @path src/tui/analytics/types.ts
 * @description Core type definitions for the TUI analytics system, including trace analysis and performance metrics.
 * @architectural-layer TUI
 * * @related-files [src/tui/analytics/correlation_analyzer.ts, src/tui/analytics/trace_analyzer.ts]
 */

export interface ITimeRange {
  start: Date;
  end: Date;
  duration: number;
}

export interface CorrelationAnalysis {
  correlationId: string;
  traceIds: string[];
  identityIds: string[];
  operations: string[];
  timeSpan: ITimeRange;
  entryCount: number;
  errorCount: number;
  performanceStats?: {
    totalDuration: number;
    avgDuration: number;
    maxDuration: number;
    minDuration: number;
  };
}

export interface TraceOperation {
  operation: string;
  timestamp: Date;
  duration?: number;
  identityId?: string;
  level: string;
  message: string;
}

export interface TraceAnalysis {
  traceId: string;
  correlationId?: string;
  operations: TraceOperation[];
  timeSpan: ITimeRange;
  errorCount: number;
  success: boolean;
}

export interface PerformanceStats {
  totalOperations: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p95Duration: number;
  errorRate: number;
}

export interface ErrorPattern {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  affectedOperations: string[];
}
