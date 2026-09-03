/**
 * @module AnalyticsTypes
 * @path apps/tui/src/analytics/types.ts
 * @description Core type definitions for the TUI analytics system, including trace analysis and performance metrics.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files [apps/tui/src/analytics/correlation_analyzer.ts, apps/tui/src/analytics/trace_analyzer.ts]
 */

export interface ITimeRange {
  start: Date;
  end: Date;
  duration: number;
}

export interface ICorrelationAnalysis {
  correlationId: string;
  traceIds: string[];
  agentRoles: string[];
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

export interface ITraceOperation {
  operation: string;
  timestamp: Date;
  duration?: number;
  agentRole?: string;
  level: string;
  message: string;
}

export interface ITraceAnalysis {
  traceId: string;
  correlationId?: string;
  operations: ITraceOperation[];
  timeSpan: ITimeRange;
  errorCount: number;
  success: boolean;
}

export interface IPerformanceStats {
  totalOperations: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p95Duration: number;
  errorRate: number;
}

export interface IErrorPattern {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  affectedOperations: string[];
}
