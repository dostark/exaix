/**
 * @module AnomalyClassification
 * @path packages/core/src/events/anomaly_classification.ts
 * @architectural-layer Core
 * @dependencies ["packages/core/src/events/domain_event_types.ts"]
 * @related-files ["packages/core/src/events/mod.ts"]
 * @description Pure functions that classify activity-journal events into anomaly
 * findings with severity, detect recovery (failure followed by success on the
 * same target), and produce roll-up summaries. No DI, no write paths, no LLM.
 */

import { DomainEventType, type TDomainEventType } from "./domain_event_types.ts";
import type { IActivityRecord } from "../types/database.ts";

export type AnomalySeverity = "high" | "medium" | "low";

export interface IAnomalyFinding {
  eventType: TDomainEventType;
  severity: AnomalySeverity;
  target: string | null;
  timestamp: string;
  recovered: boolean;
}

export interface IAnomalySummary {
  high: number;
  medium: number;
  low: number;
  recovered: number;
}

export const ANOMALY_SEVERITY_HIGH: AnomalySeverity = "high";
export const ANOMALY_SEVERITY_MEDIUM: AnomalySeverity = "medium";
export const ANOMALY_SEVERITY_LOW: AnomalySeverity = "low";

export const ANOMALY_EVENT_SEVERITY: Partial<Record<TDomainEventType, AnomalySeverity>> = {
  [DomainEventType.SecurityViolation]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.SecuritySymlinkDetected]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.SecurityPathTraversalAttempted]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.SecurityPathAccessDenied]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.ExecutionFailed]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.PlanExecutionFailed]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.McpPermissionDenied]: ANOMALY_SEVERITY_HIGH,
  [DomainEventType.ExecutionActionFailed]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.McpToolFailed]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.LlmCallFailed]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.PlanValidationFailed]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.RequestQualityGateFailed]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.GitAuditFailed]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.GitRevertPartialFailure]: ANOMALY_SEVERITY_MEDIUM,
  [DomainEventType.GitAuditTimeout]: ANOMALY_SEVERITY_LOW,
  [DomainEventType.ExecutionContextCompacted]: ANOMALY_SEVERITY_LOW,
};

const RECOVERY_PAIRINGS: Record<string, string> = {
  [DomainEventType.ExecutionActionFailed]: DomainEventType.ExecutionActionCompleted,
  [DomainEventType.McpToolFailed]: DomainEventType.McpToolExecuted,
};

const RECOVERY_SUCCESS_EVENTS = new Set(Object.values(RECOVERY_PAIRINGS));

export function classifyTraceAnomalies(activities: IActivityRecord[]): IAnomalyFinding[] {
  const findings: IAnomalyFinding[] = [];

  for (const activity of activities) {
    const eventType = activity.action_type as TDomainEventType;
    const severity = ANOMALY_EVENT_SEVERITY[eventType];
    if (!severity) continue;

    findings.push({
      eventType,
      severity,
      target: activity.target,
      timestamp: activity.timestamp,
      recovered: false,
    });
  }

  applyRecovery(findings, activities);

  return findings;
}

function applyRecovery(findings: IAnomalyFinding[], activities: IActivityRecord[]): void {
  const successByTarget = new Map<string, Set<string>>();

  for (const activity of activities) {
    if (RECOVERY_SUCCESS_EVENTS.has(activity.action_type) && activity.target !== null) {
      const set = successByTarget.get(activity.target) ?? new Set();
      set.add(activity.action_type);
      successByTarget.set(activity.target, set);
    }
  }

  for (const finding of findings) {
    const successEvent = RECOVERY_PAIRINGS[finding.eventType];
    if (!successEvent) continue;
    if (finding.target === null) continue;

    const successes = successByTarget.get(finding.target);
    if (successes?.has(successEvent)) {
      finding.recovered = true;
    }
  }
}

export function summarizeAnomalies(findings: IAnomalyFinding[]): IAnomalySummary {
  let high = 0;
  let medium = 0;
  let low = 0;
  let recovered = 0;

  for (const f of findings) {
    if (f.recovered) {
      recovered++;
    } else if (f.severity === ANOMALY_SEVERITY_HIGH) {
      high++;
    } else if (f.severity === ANOMALY_SEVERITY_MEDIUM) {
      medium++;
    } else {
      low++;
    }
  }

  return { high, medium, low, recovered };
}
