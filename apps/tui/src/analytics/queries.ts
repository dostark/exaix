/**
 * @module AnalyticsQueries
 * @path apps/tui/src/analytics/queries.ts
 * @description Collection of query functions for filtering and grouping logs by correlation, trace, and agent IDs.
 * @architectural-layer TUI
 * @ungrounded
 * @related-files [apps/tui/src/structured_log_viewer.ts]
 */

import type { IStructuredLogEntry } from "@exaix/core/types";

/**
 * Find related logs by correlation ID
 */
export function findRelatedLogs(entries: IStructuredLogEntry[], correlationId: string): IStructuredLogEntry[] {
  return entries.filter((entry) => entry.context.correlation_id === correlationId);
}

/**
 * Find related logs by trace ID
 */
export function findTraceLogs(entries: IStructuredLogEntry[], traceId: string): IStructuredLogEntry[] {
  return entries.filter((entry) => entry.context.trace_id === traceId);
}

/**
 * Find logs by agent ID
 */
export function findAgentLogs(entries: IStructuredLogEntry[], agentRole: string): IStructuredLogEntry[] {
  return entries.filter((entry) => entry.context.agent_role === agentRole);
}

/**
 * Group logs by correlation ID
 */
export function groupByCorrelation(entries: IStructuredLogEntry[]): Record<string, IStructuredLogEntry[]> {
  const groups: Record<string, IStructuredLogEntry[]> = {};
  for (const entry of entries) {
    const correlationId = entry.context.correlation_id || "no-correlation";
    if (!groups[correlationId]) {
      groups[correlationId] = [];
    }
    groups[correlationId].push(entry);
  }
  return groups;
}

/**
 * Group logs by trace ID
 */
export function groupByTrace(entries: IStructuredLogEntry[]): Record<string, IStructuredLogEntry[]> {
  const groups: Record<string, IStructuredLogEntry[]> = {};
  for (const entry of entries) {
    const traceId = entry.context.trace_id || "no-trace";
    if (!groups[traceId]) {
      groups[traceId] = [];
    }
    groups[traceId].push(entry);
  }
  return groups;
}
