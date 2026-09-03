/**
 * @module FlowRuntimeValidatorStrategyTest
 * @path packages/flow/tests/flow_runtime_validator_strategy_test.ts
 * @description Phase 159 Step 1: runtime fail-fast belt-and-suspenders check mirroring the
 *   schema refine — a flow whose step declares `strategy` while `execution_mode` is DYNAMIC,
 *   or on a non-agent step type, is rejected before any wave is scheduled.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  ExecutionStrategyName,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepType,
} from "@exaix/core";
import { FlowRuntimeValidator } from "@exaix/flow";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";

function makeStep(id: string, overrides: Partial<IFlowStep> = {}): IFlowStep {
  return {
    id,
    name: `Step ${id}`,
    type: FlowStepType.AGENT,
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: 1000 },
    ...overrides,
  };
}

function makeFlow(step: IFlowStep): IFlow {
  return {
    id: "strategy-flow",
    name: "Strategy Flow",
    description: "test",
    version: "1.0.0",
    steps: [step],
    output: { from: step.id, format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  };
}

Deno.test("FlowRuntimeValidator.validateStepStrategy passes for a DECLARED agent step with a strategy", () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s1", { strategy: ExecutionStrategyName.REACT }));
  assertEquals(validator.validateStepStrategy(flow), null);
});

Deno.test("FlowRuntimeValidator.validateStepStrategy passes for a step with no strategy", () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s1"));
  assertEquals(validator.validateStepStrategy(flow), null);
});

Deno.test("FlowRuntimeValidator.validateStepStrategy rejects strategy on a DYNAMIC step", () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(
    makeStep("s1", { execution_mode: FlowStepExecutionMode.DYNAMIC, strategy: ExecutionStrategyName.REACT }),
  );
  const err = validator.validateStepStrategy(flow);
  assertStringIncludes(err ?? "", "s1");
});

Deno.test("FlowRuntimeValidator.validateStepStrategy rejects strategy on a non-agent step", () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s1", { type: FlowStepType.GATE, strategy: ExecutionStrategyName.REACT }));
  const err = validator.validateStepStrategy(flow);
  assertStringIncludes(err ?? "", "s1");
});
