/**
 * @module FlowRuntimeValidatorAgentRoleTest
 * @path packages/flow/tests/flow_runtime_validator_agent_role_test.ts
 * @description Regression for the flow→execution agent-role hand-off: before a flow's waves
 *   are scheduled, every step's agent role must resolve to a real blueprint so hand-offs
 *   never fail mid-execution with "Blueprint not found". The runtime validator rejects a
 *   flow whose step references a missing agent role up front, and the schema validator
 *   (FlowValidatorImpl) enforces the same existence check against a real catalog.
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
import { FlowValidatorImpl } from "@exaix/flow";
import { FlowLoader } from "@exaix/flow";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";

function makeStep(id: string, agent_role: string): IFlowStep {
  return {
    id,
    name: `Step ${id}`,
    type: FlowStepType.AGENT,
    agent_role,
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: 1000 },
  };
}

function makeFlow(step: IFlowStep): IFlow {
  return {
    id: "handoff-flow",
    name: "Handoff Flow",
    description: "test",
    version: "1.0.0",
    steps: [step],
    output: { from: step.id, format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  };
}

Deno.test("FlowRuntimeValidator.validateStepAgentRoles passes when every agent role resolves", async () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s1", "senior-coder"));
  const err = await validator.validateStepAgentRoles(flow, (id: string) => Promise.resolve(id === "senior-coder"));
  assertEquals(err, null);
});

Deno.test("FlowRuntimeValidator.validateStepAgentRoles rejects a step whose agent role does not exist", async () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s2", "typo-role"));
  const err = await validator.validateStepAgentRoles(flow, (_id: string) => Promise.resolve(false));
  assertStringIncludes(err ?? "", "s2");
  assertStringIncludes(err ?? "", "typo-role");
});

Deno.test("FlowRuntimeValidator.validateStepAgentRoles passes for a strategy-forced step whose agent role resolves", async () => {
  const validator = new FlowRuntimeValidator();
  const step = makeStep("s1", "senior-coder");
  step.strategy = ExecutionStrategyName.REACT;
  const flow = makeFlow(step);
  const err = await validator.validateStepAgentRoles(flow, (id: string) => Promise.resolve(id === "senior-coder"));
  assertEquals(err, null);
});

Deno.test("FlowRuntimeValidator.validateStepAgentRoles rejects a strategy-forced step whose agent role does not exist", async () => {
  const validator = new FlowRuntimeValidator();
  const step = makeStep("s1", "typo-role");
  step.strategy = ExecutionStrategyName.CLI_DELEGATE;
  const flow = makeFlow(step);
  const err = await validator.validateStepAgentRoles(flow, (_id: string) => Promise.resolve(false));
  assertStringIncludes(err ?? "", "s1");
  assertStringIncludes(err ?? "", "typo-role");
});

Deno.test("FlowRuntimeValidator.validateStepAgentRoles covers hand-off targets (dependsOn next step)", async () => {
  const validator = new FlowRuntimeValidator();
  const first = makeStep("s1", "senior-coder");
  const next = makeStep("s2", "missing-handoff-role");
  next.dependsOn = ["s1"];
  const flow = makeFlow(first);
  flow.steps = [first, next];
  const err = await validator.validateStepAgentRoles(flow, (id: string) => Promise.resolve(id === "senior-coder"));
  assertStringIncludes(err ?? "", "s2");
});

Deno.test("FlowValidatorImpl rejects a flow whose step agent role is absent from a real blueprint catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa-flow-id-" });
  try {
    await Deno.mkdir(`${dir}/Agents`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/Agents/senior-coder.md`,
      `---\nagent_role: "senior-coder"\nname: "Senior Coder"\ncapabilities: ["react"]\n---\n`,
    );

    const loader = new FlowLoader(dir);
    await Deno.writeTextFile(
      `${dir}/bad-flow.flow.yaml`,
      `id: "bad-flow"
name: "Bad Flow"
description: "bad"
steps:
  - id: "s1"
    name: "S1"
    agent_role: "typo-role"
    dependsOn: []
    input:
      source: "request"
      transform: "passthrough"
    retry:
      maxAttempts: 1
      backoffMs: 1000
output: { from: "s1", format: "markdown" }
`,
    );

    const validator = new FlowValidatorImpl(loader, dir);
    const result = await validator.validateFlow("bad-flow");
    assertEquals(result.valid, false);
    assertStringIncludes(result.error ?? "", "typo-role");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl accepts a flow whose step agent roles exist in the catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa-flow-id-" });
  try {
    await Deno.mkdir(`${dir}/Agents`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/Agents/senior-coder.md`,
      `---\nagent_role: "senior-coder"\nname: "Senior Coder"\ncapabilities: ["react"]\n---\n`,
    );

    const loader = new FlowLoader(dir);
    await Deno.writeTextFile(
      `${dir}/good-flow.flow.yaml`,
      `id: "good-flow"
name: "Good Flow"
description: "good"
steps:
  - id: "s1"
    name: "S1"
    agent_role: "senior-coder"
    dependsOn: []
    input:
      source: "request"
      transform: "passthrough"
    retry:
      maxAttempts: 1
      backoffMs: 1000
output: { from: "s1", format: "markdown" }
`,
    );

    const validator = new FlowValidatorImpl(loader, dir);
    const result = await validator.validateFlow("good-flow");
    assertEquals(result.valid, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
