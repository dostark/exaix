/**
 * @module DelegateCycleFixturesTest
 * @path packages/testing/tests/delegate_cycle_fixtures_test.ts
 * @description The delegate-cycle fixtures build a step and a one-step flow that the real flow schema accepts, with the review gate the cycle tests rely on.
 * @architectural-layer Test
 * @related-files [packages/testing/src/helpers/delegate_cycle_fixtures.ts]
 */

import { assertEquals } from "@std/assert";
import { FlowGateOnFail, FlowStepType } from "@exaix/core";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { delegateCycleFlow, delegateCycleStep } from "../src/helpers/delegate_cycle_fixtures.ts";

Deno.test("the delegate-cycle step is a session_delegate_cycle step with a halting review gate", () => {
  const step = delegateCycleStep();
  assertEquals(step.id, "next-steps");
  assertEquals(step.type, FlowStepType.SESSION_DELEGATE_CYCLE);
  assertEquals(step.agent_role, "senior-coder");
  assertEquals(step.delegateCycle?.requireChangedPaths, true);
  assertEquals(step.delegateCycle?.review.onFail, FlowGateOnFail.HALT);
  assertEquals(step.delegateCycle?.review.agent_role, "senior-reviewer");
});

Deno.test("the step id can be chosen, and each call returns a fresh object", () => {
  assertEquals(delegateCycleStep("other").id, "other");
  const first = delegateCycleStep();
  first.name = "changed";
  assertEquals(delegateCycleStep().name, "Next Steps");
});

Deno.test("the delegate-cycle flow is one step that outputs its own result and passes the flow schema", () => {
  const flow = delegateCycleFlow("cycle-flow", "Cycle Flow");
  assertEquals(flow.id, "cycle-flow");
  assertEquals(flow.name, "Cycle Flow");
  assertEquals(flow.steps.map((step) => step.id), ["next-steps"]);
  assertEquals(flow.output.from, "next-steps");
  FlowSchema.parse(flow);
});
