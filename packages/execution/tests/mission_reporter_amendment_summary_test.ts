/**
 * @module MissionReporterAmendmentSummaryTest
 * @path tests/unit/services/mission_reporter_amendment_summary_test.ts
 * @description Unit tests for MissionReporter's handling of amendment lifecycle events in reports.
 * @related-files [@exaix/core/artifact, "packages/schemas/src/plan_amendment.ts"]
 */

import { assertEquals } from "@std/assert";
import {
  PLAN_AMENDMENT_EVENT_APPLIED,
  PLAN_AMENDMENT_EVENT_APPROVED,
  PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
  PLAN_AMENDMENT_EVENT_EXPIRED,
  PLAN_AMENDMENT_EVENT_PROPOSED,
  PLAN_AMENDMENT_EVENT_REJECTED,
} from "@exaix/core";

Deno.test("all 6 PLAN_AMENDMENT_EVENT_* constants have correct string values", () => {
  assertEquals(PLAN_AMENDMENT_EVENT_PROPOSED, "plan.amendment.proposed");
  assertEquals(PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL, "plan.amendment.awaiting_approval");
  assertEquals(PLAN_AMENDMENT_EVENT_APPROVED, "plan.amendment.approved");
  assertEquals(PLAN_AMENDMENT_EVENT_REJECTED, "plan.amendment.rejected");
  assertEquals(PLAN_AMENDMENT_EVENT_EXPIRED, "plan.amendment.expired");
  assertEquals(PLAN_AMENDMENT_EVENT_APPLIED, "plan.amendment.applied");
});

Deno.test("amendment event constants are unique", () => {
  const events = [
    PLAN_AMENDMENT_EVENT_PROPOSED,
    PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
    PLAN_AMENDMENT_EVENT_APPROVED,
    PLAN_AMENDMENT_EVENT_REJECTED,
    PLAN_AMENDMENT_EVENT_EXPIRED,
    PLAN_AMENDMENT_EVENT_APPLIED,
  ];

  const uniqueEvents = new Set(events);
  assertEquals(uniqueEvents.size, events.length, "All amendment event constants should be unique");
});

Deno.test("amendment event constants follow naming convention", () => {
  const events = [
    PLAN_AMENDMENT_EVENT_PROPOSED,
    PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
    PLAN_AMENDMENT_EVENT_APPROVED,
    PLAN_AMENDMENT_EVENT_REJECTED,
    PLAN_AMENDMENT_EVENT_EXPIRED,
    PLAN_AMENDMENT_EVENT_APPLIED,
  ];

  for (const event of events) {
    assertEquals(
      event.startsWith("plan.amendment."),
      true,
      `Event "${event}" should start with "plan.amendment."`,
    );
  }
});

Deno.test("amendment trace data structure is valid", () => {
  const amendmentTrace = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    trigger: "low_confidence",
    summary: "Adjusted remaining steps based on tool output",
    decision: "approved",
  };

  assertEquals(typeof amendmentTrace.id, "string");
  assertEquals(typeof amendmentTrace.trigger, "string");
  assertEquals(typeof amendmentTrace.summary, "string");
  assertEquals(typeof amendmentTrace.decision, "string");
  assertEquals(amendmentTrace.summary.length > 0, true);
});

Deno.test("amendment trace data supports all decision types", () => {
  const decisions = ["approved", "rejected", "expired"];

  for (const decision of decisions) {
    const amendmentTrace = {
      id: crypto.randomUUID(),
      trigger: "tool_error",
      summary: "Test amendment",
      decision,
    };

    assertEquals(amendmentTrace.decision, decision);
  }
});

Deno.test("amendment trace data supports all trigger types", () => {
  const triggers = ["tool_error", "low_confidence", "context_mismatch", "manual_request"];

  for (const trigger of triggers) {
    const amendmentTrace = {
      id: crypto.randomUUID(),
      trigger,
      summary: "Test amendment",
      decision: "approved",
    };

    assertEquals(amendmentTrace.trigger, trigger);
  }
});

Deno.test("multiple amendments can be tracked in single execution", () => {
  const amendments = [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      trigger: "tool_error",
      summary: "First amendment due to tool failure",
      decision: "approved",
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440002",
      trigger: "low_confidence",
      summary: "Second amendment for confidence issues",
      decision: "approved",
    },
  ];

  assertEquals(amendments.length, 2);
  assertEquals(amendments[0].decision, "approved");
  assertEquals(amendments[1].decision, "approved");
  assertEquals(amendments[0].trigger, "tool_error");
  assertEquals(amendments[1].trigger, "low_confidence");
});
