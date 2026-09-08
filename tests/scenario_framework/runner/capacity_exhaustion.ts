/**
 * @module ScenarioFrameworkCapacityExhaustion
 * @path tests/scenario_framework/runner/capacity_exhaustion.ts
 * @description Detects a real HTTP 400/429 signal (provider credit/quota exhaustion or rate
 *   limiting) in a scenario run's own failure-adjacent journal activities. The suite-level
 *   counterpart to step_executor.ts's wait-for-file early-exit: that stops the CURRENT step
 *   fast on any failure, but every remaining scenario in the run would just re-hit the same
 *   exhausted provider resource — main.ts's suite loop uses this to stop the ENTIRE run
 *   instead. Root cause: a live test failed with "HTTP 400 invalid_request_error: Your
 *   credit balance is too low..."; CLI-delegate calls report the equivalent via a JSON
 *   "api_error_status" field, surfaced in the failure payload since the stdout-visibility fix.
 * @architectural-layer Test
 * @dependencies [@db/sqlite]
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/failure_classifier.ts, tests/scenario_framework/runner/step_executor.ts]
 */

import type { IActivityRecord } from "@exaix/core/types";
import { loadTraceActivities } from "./failure_classifier.ts";

export interface ICapacityExhaustionSignal {
  readonly detected: boolean;
  /** The raw payload the signal was found in, for the operator-facing stop message. */
  readonly evidence?: string;
}

/** action_types whose payload can carry a real provider error message/JSON. */
const FAILURE_ADJACENT_ACTIONS: readonly string[] = ["llm.call.failed", "agent.execution_failed", "request.failed"];

// Matches the direct-API shape ("HTTP 400 ...") and the CLI-delegate JSON shape
// ("api_error_status":400/429) — the latter arrives backslash-escaped once the raw stdout JSON
// is re-serialized as a string value inside the outer activity payload.
const CAPACITY_EXHAUSTION_PATTERNS: readonly RegExp[] = [
  /\bHTTP 400\b/,
  /\bHTTP 429\b/,
  /\\?"api_error_status\\?"\s*:\s*400\b/,
  /\\?"api_error_status\\?"\s*:\s*429\b/,
];

/** Pure: scans already-loaded activities. Only failure-adjacent action_types are inspected —
 *  an incidental "429"/"HTTP 400" substring in unrelated telemetry must never trigger a stop. */
export function detectCapacityExhaustion(activities: readonly IActivityRecord[]): ICapacityExhaustionSignal {
  for (const activity of activities) {
    if (!FAILURE_ADJACENT_ACTIONS.includes(activity.action_type)) continue;
    for (const pattern of CAPACITY_EXHAUSTION_PATTERNS) {
      if (pattern.test(activity.payload)) {
        return { detected: true, evidence: activity.payload };
      }
    }
  }
  return { detected: false };
}

/** journalPath -> trace activities -> capacity-exhaustion signal, the production join
 *  main.ts's suite loop calls once per completed scenario. */
export function computeRunCapacityExhaustion(journalPath: string): ICapacityExhaustionSignal {
  return detectCapacityExhaustion(loadTraceActivities(journalPath));
}
