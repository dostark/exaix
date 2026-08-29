/**
 * @module FlowSessionDelegateCycleSchemaTest
 * @path packages/schemas/tests/flow_session_delegate_cycle_test.ts
 * @description Verifies FlowStepSchema's `session_delegate_cycle` cross-field rules
 *   (Phase 174 Step 2): `delegateCycle` config is required on and only valid on a
 *   session_delegate_cycle step, and such a step may not carry `strategy` or
 *   `execution_mode: dynamic`.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/flow.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import { ExecutionStrategyName, FlowStepExecutionMode, FlowStepType } from "@exaix/core";

const VALID_DELEGATE_CYCLE = {
  requireChangedPaths: true as const,
  review: {
    identity: "senior-reviewer",
    criteria: ["correctness"],
  },
};

Deno.test("[schema] session_delegate_cycle step requires delegateCycle config", () => {
  const step = {
    id: "cycle-step",
    name: "Cycle Step",
    identity: "senior-coder",
    type: FlowStepType.SESSION_DELEGATE_CYCLE,
  };
  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("[schema] session_delegate_cycle step with delegateCycle config parses successfully", () => {
  const step = {
    id: "cycle-step",
    name: "Cycle Step",
    identity: "senior-coder",
    type: FlowStepType.SESSION_DELEGATE_CYCLE,
    delegateCycle: VALID_DELEGATE_CYCLE,
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.delegateCycle?.requireChangedPaths, true);
  assertEquals(result.delegateCycle?.review.identity, "senior-reviewer");
});

Deno.test("[schema] delegateCycle on a non-cycle step type is rejected", () => {
  const step = {
    id: "agent-step",
    name: "Agent Step",
    identity: "senior-coder",
    type: FlowStepType.AGENT,
    delegateCycle: VALID_DELEGATE_CYCLE,
  };
  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("[schema] session_delegate_cycle step rejects strategy", () => {
  const step = {
    id: "cycle-step",
    name: "Cycle Step",
    identity: "senior-coder",
    type: FlowStepType.SESSION_DELEGATE_CYCLE,
    delegateCycle: VALID_DELEGATE_CYCLE,
    strategy: ExecutionStrategyName.CLI_DELEGATE,
  };
  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("[schema] session_delegate_cycle step rejects execution_mode: dynamic", () => {
  const step = {
    id: "cycle-step",
    name: "Cycle Step",
    identity: "senior-coder",
    type: FlowStepType.SESSION_DELEGATE_CYCLE,
    delegateCycle: VALID_DELEGATE_CYCLE,
    execution_mode: FlowStepExecutionMode.DYNAMIC,
  };
  assertThrows(() => FlowStepSchema.parse(step));
});

Deno.test("[schema] requireChangedPaths defaults to true when omitted", () => {
  const step = {
    id: "cycle-step",
    name: "Cycle Step",
    identity: "senior-coder",
    type: FlowStepType.SESSION_DELEGATE_CYCLE,
    delegateCycle: { review: VALID_DELEGATE_CYCLE.review },
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.delegateCycle?.requireChangedPaths, true);
});
