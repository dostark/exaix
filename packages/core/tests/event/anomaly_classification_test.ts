/**
 * @module AnomalyClassificationTest
 * @path packages/core/tests/event/anomaly_classification_test.ts
 * @description Tests for the anomaly classification module — ensures event-type-to-severity mapping,
 * recovery-rule logic, summarization, and determinism.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DomainEventType } from "@exaix/core/events";
import type { IActivityRecord } from "@exaix/core/types";

// Import the not-yet-existing source — RED will fail until anomaly_classification.ts is created
import {
  ANOMALY_SEVERITY_HIGH,
  ANOMALY_SEVERITY_LOW,
  ANOMALY_SEVERITY_MEDIUM,
  classifyTraceAnomalies,
  type IAnomalyFinding,
  summarizeAnomalies,
} from "../../src/events/anomaly_classification.ts";

function makeActivity(overrides: Partial<IActivityRecord>): IActivityRecord {
  const defaults: IActivityRecord = {
    id: "test-id",
    trace_id: "test-trace",
    actor: null,
    actor_type: null,
    agent_role: null,
    action_type: DomainEventType.McpToolExecuted,
    target: null,
    payload: "{}",
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  return { ...defaults, ...overrides };
}

describe("Classify", () => {
  it("McpToolFailed maps to a medium finding", () => {
    const activities = [makeActivity({ action_type: DomainEventType.McpToolFailed, target: "read_file" })];
    const findings = classifyTraceAnomalies(activities);
    assertEquals(findings.length, 1);
    assertEquals(findings[0].severity, ANOMALY_SEVERITY_MEDIUM);
    assertEquals(findings[0].eventType, DomainEventType.McpToolFailed);
    assertEquals(findings[0].target, "read_file");
    assertEquals(findings[0].recovered, false);
  });

  it("SecurityViolation maps to a high finding", () => {
    const activities = [makeActivity({ action_type: DomainEventType.SecurityViolation, target: "/etc/passwd" })];
    const findings = classifyTraceAnomalies(activities);
    assertEquals(findings.length, 1);
    assertEquals(findings[0].severity, ANOMALY_SEVERITY_HIGH);
    assertEquals(findings[0].recovered, false);
  });

  it("non-anomaly event (e.g. McpToolExecuted) yields no finding", () => {
    const activities = [makeActivity({ action_type: DomainEventType.McpToolExecuted, target: "read_file" })];
    const findings = classifyTraceAnomalies(activities);
    assertEquals(findings.length, 0);
  });

  it("empty activities yields no findings", () => {
    const findings = classifyTraceAnomalies([]);
    assertEquals(findings, []);
  });
});

describe("Recovery", () => {
  it("ExecutionActionFailed followed by ExecutionActionCompleted on same target is marked recovered and excluded from medium count", () => {
    const activities: IActivityRecord[] = [
      makeActivity({
        action_type: DomainEventType.ExecutionActionFailed,
        target: "step-1",
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      makeActivity({
        action_type: DomainEventType.ExecutionActionCompleted,
        target: "step-1",
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
    ];
    const findings = classifyTraceAnomalies(activities);
    assertEquals(findings.length, 1);
    assertEquals(findings[0].recovered, true);
    assertEquals(findings[0].severity, ANOMALY_SEVERITY_MEDIUM);
  });

  it("McpToolFailed with no later success on same target counts as medium", () => {
    const activities: IActivityRecord[] = [
      makeActivity({
        action_type: DomainEventType.McpToolFailed,
        target: "read_file",
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
    ];
    const findings = classifyTraceAnomalies(activities);
    assertEquals(findings.length, 1);
    assertEquals(findings[0].recovered, false);
    assertEquals(findings[0].severity, ANOMALY_SEVERITY_MEDIUM);
  });
});

describe("Summarize", () => {
  it("counts roll up correctly with recovered collapsed", () => {
    const findings: IAnomalyFinding[] = [
      {
        eventType: DomainEventType.SecurityViolation,
        severity: ANOMALY_SEVERITY_HIGH,
        target: null,
        timestamp: "",
        recovered: false,
      },
      {
        eventType: DomainEventType.McpToolFailed,
        severity: ANOMALY_SEVERITY_MEDIUM,
        target: "tool-a",
        timestamp: "",
        recovered: false,
      },
      {
        eventType: DomainEventType.McpToolFailed,
        severity: ANOMALY_SEVERITY_MEDIUM,
        target: "tool-b",
        timestamp: "",
        recovered: true,
      },
      {
        eventType: DomainEventType.GitAuditTimeout,
        severity: ANOMALY_SEVERITY_LOW,
        target: null,
        timestamp: "",
        recovered: false,
      },
    ];
    const summary = summarizeAnomalies(findings);
    assertEquals(summary, { high: 1, medium: 1, low: 1, recovered: 1 });
  });

  it("empty findings yields zeroed summary", () => {
    const summary = summarizeAnomalies([]);
    assertEquals(summary, { high: 0, medium: 0, low: 0, recovered: 0 });
  });
});

describe("Determinism", () => {
  it("identical activities yield identical summary", () => {
    const activities: IActivityRecord[] = [
      makeActivity({
        action_type: DomainEventType.SecurityViolation,
        target: "/etc",
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
      makeActivity({
        action_type: DomainEventType.McpToolFailed,
        target: "read_file",
        timestamp: "2026-01-01T00:00:02.000Z",
      }),
    ];
    const run1 = summarizeAnomalies(classifyTraceAnomalies(activities));
    const run2 = summarizeAnomalies(classifyTraceAnomalies(activities));
    assertEquals(run1, run2);
  });
});
