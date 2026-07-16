/**
 * @module TrajectoryEventParityTest
 * @path tests/scenario_framework/tests/unit/trajectory_event_parity_test.ts
 * @description Ensures the shared ACTIVITY_EVENT_DYNAMIC_TOOL_CALL constant
 * used by trajectory_evaluator.ts matches the actual event logged by
 * dynamic_step_executor.ts — prevents the event-type drift that caused W3.
 */

import { assertEquals } from "@std/assert";
import { ACTIVITY_EVENT_DYNAMIC_TOOL_CALL } from "@exaix/core";

Deno.test("[TrajectoryParity] shared constant matches dynamic_step_executor event type", () => {
  assertEquals(ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, "dynamic_tool_call");
});

Deno.test("[TrajectoryParity] constant is not a milestone constant", () => {
  assertEquals(ACTIVITY_EVENT_DYNAMIC_TOOL_CALL.includes("milestone"), false);
  assertEquals(ACTIVITY_EVENT_DYNAMIC_TOOL_CALL.includes("tool.call."), false);
});
