/**
 * @module ExecutionAlignmentClassTest
 * @path tests/scenario_framework/tests/unit/execution_alignment_class_test.ts
 * @description Phase 143 Step 5 — RED-first tests for the eval-only `execution-alignment`
 *   failure class: a run whose trace carries `session.delegate.reconciled` (the delegate's work
 *   was accepted/reconciled — "plausible work") AND whose outcome score is below the pass
 *   threshold ("failed verification") is flagged `execution-alignment`. Reconciled runs that
 *   passed are not flagged.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/failure_classifier.ts]
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import type { IActivityRecord } from "@exaix/core/types";
import { computeFailureClasses } from "../../runner/failure_classifier.ts";

function makeActivity(overrides: Partial<IActivityRecord>): IActivityRecord {
  return {
    id: "a",
    trace_id: "run-trace",
    actor: null,
    actor_type: null,
    agent_role: null,
    action_type: DomainEventType.SessionDelegateReconciled,
    target: "run-trace",
    payload: "{}",
    timestamp: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("[ExecutionAlignment] reconciled + failed outcome is flagged", () => {
  const activities = [makeActivity({ action_type: DomainEventType.SessionDelegateReconciled })];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.4, scoreThreshold: 0.5 });
  assertEquals(classes.includes("execution-alignment"), true);
});

Deno.test("[ExecutionAlignment] reconciled + passing outcome is NOT flagged", () => {
  const activities = [makeActivity({ action_type: DomainEventType.SessionDelegateReconciled })];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.9, scoreThreshold: 0.5 });
  assertEquals(classes.includes("execution-alignment"), false);
});

Deno.test("[ExecutionAlignment] no reconciled event is never flagged", () => {
  const activities = [makeActivity({ action_type: DomainEventType.ExecutionFailed })];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.4, scoreThreshold: 0.5 });
  assertEquals(classes.includes("execution-alignment"), false);
});

Deno.test("[ExecutionAlignment] threshold boundary: score equal to threshold is a pass", () => {
  const activities = [makeActivity({ action_type: DomainEventType.SessionDelegateReconciled })];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.5, scoreThreshold: 0.5 });
  assertEquals(classes.includes("execution-alignment"), false, "score === threshold passes");
});

Deno.test("[ExecutionAlignment] coexists with anomaly classes", () => {
  const activities = [
    makeActivity({ action_type: DomainEventType.SessionDelegateReconciled }),
    makeActivity({ action_type: DomainEventType.ExecutionFailed, target: "exec" }),
  ];
  const classes = computeFailureClasses({ activities, outcomeScore: 0.4, scoreThreshold: 0.5 });
  assertEquals(classes.includes("execution-alignment"), true);
  assertEquals(classes.includes("execution.failed"), true);
});
