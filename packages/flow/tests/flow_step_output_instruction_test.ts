/**
 * @module FlowStepOutputInstructionTest
 * @path packages/flow/tests/flow_step_output_instruction_test.ts
 * @description Verifies that the flow output instruction follows the step's output contract instead of overriding a specialised contract skill.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_step_prompts.ts]
 */

import { assertNotMatch, assertStringIncludes } from "@std/assert";
import { OutputContract } from "@exaix/core";
import type { IFlow, IFlowStep } from "@exaix/schemas";
import { flowStepOutputInstruction } from "../src/flow_step_prompts.ts";

const PLAN_SHAPE_MARKER = "Flow Step Output";
const REPORT_PHRASE = "report object";

function agentStep(overrides: Partial<IFlowStep> = {}): IFlowStep {
  return {
    id: "analyze",
    name: "Analyze",
    agent_role: "code-analyst",
    dependsOn: [],
    input: { source: "request", from: "request" },
    ...overrides,
  } as IFlowStep;
}

function flowOf(step: IFlowStep): IFlow {
  return { id: "f", name: "f", version: "1.0.0", steps: [step], output: { from: step.id, format: "json" } } as IFlow;
}

Deno.test("fix(flow): a step without a declared contract offers the plan or one report object", () => {
  const step = agentStep();
  const text = flowStepOutputInstruction(step, flowOf(step));
  assertStringIncludes(text, PLAN_SHAPE_MARKER);
  assertStringIncludes(text, REPORT_PHRASE);
});

Deno.test("fix(flow): a step with a specialised contract defers the shape to its contract skill", () => {
  const step = agentStep({ output_contract: OutputContract.ANALYSIS });
  const text = flowStepOutputInstruction(step, flowOf(step));
  assertNotMatch(text, new RegExp(PLAN_SHAPE_MARKER));
  assertStringIncludes(text, REPORT_PHRASE);
  assertStringIncludes(text, "<content>");
});

Deno.test("fix(flow): a step with the plan contract keeps the plan shape only", () => {
  const step = agentStep({ output_contract: OutputContract.PLAN });
  const text = flowStepOutputInstruction(step, flowOf(step));
  assertStringIncludes(text, PLAN_SHAPE_MARKER);
  assertNotMatch(text, new RegExp(REPORT_PHRASE));
});
