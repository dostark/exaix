/**
 * @module CapacityExhaustionTest
 * @path tests/scenario_framework/tests/unit/capacity_exhaustion_test.ts
 * @description RED-first tests for the suite-level capacity/quota-exhaustion detector.
 *   `detectCapacityExhaustion` scans a run's own failure-adjacent activity payloads for a
 *   real HTTP 400/429 signal from a live provider/CLI call — the signal `main.ts`'s suite
 *   loop uses to stop the ENTIRE run (not just skip the current scenario), since every
 *   remaining scenario would otherwise just re-hit the same exhausted resource. Root cause:
 *   a live [live] test failed with "HTTP 400 invalid_request_error: Your credit balance is
 *   too low..."; Claude/codex CLI calls report the equivalent via a JSON "api_error_status".
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/capacity_exhaustion.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import type { IActivityRecord } from "@exaix/core/types";
import { detectCapacityExhaustion } from "../../runner/capacity_exhaustion.ts";

function makeActivity(overrides: Partial<IActivityRecord>): IActivityRecord {
  return {
    id: "a",
    trace_id: "run-trace",
    actor: null,
    actor_type: null,
    agent_role: null,
    action_type: DomainEventType.McpToolExecuted,
    target: null,
    payload: "{}",
    timestamp: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("[CapacityExhaustion] detects HTTP 400 in an llm.call.failed payload (direct-API credit-balance case)", () => {
  const activities = [
    makeActivity({
      action_type: "llm.call.failed",
      payload: JSON.stringify({
        error: "HTTP 400 invalid_request_error: Your credit balance is too low to access the Anthropic API.",
      }),
    }),
  ];
  const result = detectCapacityExhaustion(activities);
  assertEquals(result.detected, true);
});

Deno.test("[CapacityExhaustion] detects HTTP 429 in an llm.call.failed payload", () => {
  const activities = [
    makeActivity({
      action_type: "llm.call.failed",
      payload: JSON.stringify({ error: "HTTP 429 rate_limit_error: rate limit exceeded" }),
    }),
  ];
  const result = detectCapacityExhaustion(activities);
  assertEquals(result.detected, true);
});

Deno.test("[CapacityExhaustion] detects api_error_status 429 inside a CLI delegate's surfaced stdout (agent.execution_failed)", () => {
  const activities = [
    makeActivity({
      action_type: "agent.execution_failed",
      payload: JSON.stringify({
        error_message:
          'CLI delegate \'claude\' exited with code 1: stderr=(empty) stdout={"is_error":true,"api_error_status":429,"result":"rate limited"}',
      }),
    }),
  ];
  const result = detectCapacityExhaustion(activities);
  assertEquals(result.detected, true);
});

Deno.test("[CapacityExhaustion] detects api_error_status 400 inside a request.failed payload", () => {
  const activities = [
    makeActivity({
      action_type: "request.failed",
      payload: JSON.stringify({ error: 'stdout={"api_error_status":400,"result":"insufficient credits"}' }),
    }),
  ];
  const result = detectCapacityExhaustion(activities);
  assertEquals(result.detected, true);
});

Deno.test("[CapacityExhaustion] an ordinary failure (no 400/429 signal) is not flagged", () => {
  const activities = [
    makeActivity({
      action_type: "agent.execution_failed",
      payload: JSON.stringify({
        error_message: "CLI delegate 'claude' exited with code 1: stderr=(empty) stdout=(empty)",
      }),
    }),
    makeActivity({
      action_type: "llm.call.failed",
      payload: JSON.stringify({ error: "CliDelegateModelProvider 'claude' exited with code 1: authentication failed" }),
    }),
  ];
  const result = detectCapacityExhaustion(activities);
  assertEquals(result.detected, false);
});

Deno.test("[CapacityExhaustion] a 400/429 substring in an UNRELATED action_type is ignored (only failure-adjacent events count)", () => {
  const activities = [
    makeActivity({
      action_type: "agent.prompt_assembled",
      payload: JSON.stringify({ note: "unrelated mention of 429 or HTTP 400 in normal telemetry" }),
    }),
  ];
  const result = detectCapacityExhaustion(activities);
  assertEquals(result.detected, false);
});

Deno.test("[CapacityExhaustion] empty activity list is not flagged", () => {
  const result = detectCapacityExhaustion([]);
  assertEquals(result.detected, false);
});
