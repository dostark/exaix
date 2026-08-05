/**
 * @module ScenarioFrameworkFailureClassifier
 * @path tests/scenario_framework/runner/failure_classifier.ts
 * @description Phase 143 Step 5 — joins a scenario run's journal trace activities into the
 *   eval history `failure_classes` list. The classes are the distinct unrecovered
 *   `IAnomalyFinding.eventType` values from the existing anomaly projection
 *   (`classifyTraceAnomalies`, packages/core/src/events/anomaly_classification.ts) plus the
 *   eval-only literal `execution-alignment` class: a run whose trace carries
 *   `session.delegate.reconciled` (the delegate's work was accepted — "plausible work") and
 *   whose outcome score is below the pass threshold ("failed verification"). The run's trace is
 *   recovered from the workspace journal via the `request.created` marker event. Pure functions
 *   over journal paths / activity records — shared by the runner (main.ts) at history-write time
 *   and the unit tests.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @db/sqlite]
 * @related-files [tests/scenario_framework/runner/main.ts, packages/core/src/events/anomaly_classification.ts]
 */

import { Database } from "@db/sqlite";
import { DomainEventType } from "@exaix/core/events";
import type { IActivityRecord } from "@exaix/core/types";
import { classifyTraceAnomalies } from "@exaix/core/events";
import { DEFAULT_EVAL_SCORE_THRESHOLD } from "./scoring.ts";

export interface IFailureClassInput {
  /** The run's journal activities (its trace). */
  activities: IActivityRecord[];
  /** The run's outcome score (suite score). */
  outcomeScore: number;
  /** The pass threshold; absent ⇒ the eval default (0.5). */
  scoreThreshold: number | undefined;
}

/** The eval-only failure class for "plausible work, failed verification" (Phase 143 Step 5). */
export const EXECUTION_ALIGNMENT_CLASS = "execution-alignment";

/** The journal event that marks a scenario run's trace_id (emitted by the request daemon). */
const RUN_TRACE_MARKER_EVENT = "request.created";

/**
 * Map a run's trace activities to its failure classes: the distinct unrecovered anomaly
 * eventTypes from `classifyTraceAnomalies` (recovered findings excluded per the existing
 * recovery-pairing semantics), plus `execution-alignment` when a `session.delegate.reconciled`
 * event is present AND the outcome score is below the threshold. Sorted for determinism.
 */
export function computeFailureClasses(input: IFailureClassInput): string[] {
  const classes = new Set<string>();
  for (const finding of classifyTraceAnomalies(input.activities)) {
    if (!finding.recovered) classes.add(finding.eventType);
  }
  const reconciled = input.activities.some(
    (activity) => activity.action_type === DomainEventType.SessionDelegateReconciled,
  );
  const threshold = input.scoreThreshold ?? DEFAULT_EVAL_SCORE_THRESHOLD;
  if (reconciled && input.outcomeScore < threshold) {
    classes.add(EXECUTION_ALIGNMENT_CLASS);
  }
  return [...classes].sort();
}

/**
 * Load a scenario run's trace activities from its workspace journal: the run's trace_id is the
 * first `request.created` event's, then all activities for that trace are returned. A missing
 * journal or absent marker yields an empty trace (no failure classes).
 */
export function loadTraceActivities(journalPath: string): IActivityRecord[] {
  const db = new Database(journalPath, { readonly: true });
  try {
    const marker = db.prepare(
      "SELECT trace_id FROM activity WHERE action_type = ? ORDER BY rowid ASC LIMIT 1",
    ).get<{ trace_id: string }>(RUN_TRACE_MARKER_EVENT);
    if (!marker) return [];
    return db.prepare(
      `SELECT id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload,
              prompt_tokens, completion_tokens, cost_usd, timestamp
       FROM activity WHERE trace_id = ? ORDER BY timestamp`,
    ).all(marker.trace_id) as IActivityRecord[];
  } finally {
    db.close();
  }
}

/** The production join the runner invokes: journal path → trace activities → failure classes. */
export function computeRunFailureClasses(input: {
  journalPath: string;
  outcomeScore: number;
  scoreThreshold: number | undefined;
}): string[] {
  const activities = loadTraceActivities(input.journalPath);
  return computeFailureClasses({
    activities,
    outcomeScore: input.outcomeScore,
    scoreThreshold: input.scoreThreshold,
  });
}
