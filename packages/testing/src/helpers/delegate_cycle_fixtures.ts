/**
 * @module DelegateCycleFixtures
 * @path packages/testing/src/helpers/delegate_cycle_fixtures.ts
 * @description Builds the session_delegate_cycle flow step and the one-step flow that the delegate-cycle tests in the daemon and the flow package share.
 * @architectural-layer Testing
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/testing/mod.ts]
 */

import { FlowGateOnFail, FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IFlow } from "@exaix/schemas/flow.ts";

/** One step of a flow, as the flow schema defines it. */
type TFlowStep = IFlow["steps"][number];

/** The id of the delegate-cycle step in the shared flow. */
export const DELEGATE_CYCLE_STEP_ID = "next-steps";

/** A session_delegate_cycle step whose review gate halts on failure. Each call returns a new object. */
export function delegateCycleStep(id: string): TFlowStep {
  return {
    id,
    name: "Next Steps",
    type: FlowStepType.SESSION_DELEGATE_CYCLE,
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: 1000 },
    delegateCycle: {
      requireChangedPaths: true,
      review: {
        agent_role: "senior-reviewer",
        criteria: ["correctness"],
        threshold: 0.8,
        onFail: FlowGateOnFail.HALT,
        maxRetries: 3,
        includeRequestCriteria: false,
      },
    },
  };
}

/** A flow of the one delegate-cycle step, which also supplies the flow output. */
export function delegateCycleFlow(id: string, name: string): IFlow {
  return {
    id,
    name,
    description: "test",
    version: "1.0.0",
    steps: [delegateCycleStep(DELEGATE_CYCLE_STEP_ID)],
    output: { from: DELEGATE_CYCLE_STEP_ID, format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  };
}
