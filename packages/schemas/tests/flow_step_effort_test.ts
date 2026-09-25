/**
 * @module FlowStepEffortTest
 * @path packages/schemas/tests/flow_step_effort_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies FlowStepSchema supports the optional per-step `effort`/`thinking`
 *   declarations (phase-197 Step 4): a DECLARED agent step may declare them (including
 *   "auto"), a non-agent step may not, and an invalid effort value is rejected.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import { FlowStepType } from "@exaix/core";

Deno.test("FlowStepSchema: accepts effort auto and thinking auto on a declared agent step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    effort: "auto",
    thinking: "auto",
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.effort, "auto");
  assertEquals(result.thinking, "auto");
});

Deno.test("FlowStepSchema: accepts concrete effort/thinking on a declared agent step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    effort: "high",
    thinking: false,
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.effort, "high");
  assertEquals(result.thinking, false);
});

Deno.test("FlowStepSchema: effort/thinking are undefined when not specified", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.effort, undefined);
  assertEquals(result.thinking, undefined);
});

Deno.test("FlowStepSchema: rejects effort turbo on a declared agent step", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    effort: "turbo",
  };
  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("FlowStepSchema: rejects effort on a non-agent step type", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    type: FlowStepType.GATE,
    effort: "high",
  };
  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("FlowStepSchema: rejects thinking on a non-agent step type", () => {
  const step = {
    id: "test-step",
    name: "Test Step",
    agent_role: "senior-coder",
    type: FlowStepType.GATE,
    thinking: "auto",
  };
  assertThrows(() => FlowStepSchema.parse(step));
});
