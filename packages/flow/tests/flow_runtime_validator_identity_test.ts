/**
 * @module FlowRuntimeValidatorIdentityTest
 * @path packages/flow/tests/flow_runtime_validator_identity_test.ts
 * @description Regression for the flow→execution identity hand-off: before a flow's waves
 *   are scheduled, every step's identity must resolve to a real blueprint so hand-offs
 *   never fail mid-execution with "Blueprint not found". The runtime validator rejects a
 *   flow whose step references a missing identity up front, and the schema validator
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

function makeStep(id: string, identity: string): IFlowStep {
  return {
    id,
    name: `Step ${id}`,
    type: FlowStepType.AGENT,
    identity,
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

Deno.test("FlowRuntimeValidator.validateStepIdentities passes when every identity resolves", async () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s1", "senior-coder"));
  const err = await validator.validateStepIdentities(flow, (id: string) => Promise.resolve(id === "senior-coder"));
  assertEquals(err, null);
});

Deno.test("FlowRuntimeValidator.validateStepIdentities rejects a step whose identity does not exist", async () => {
  const validator = new FlowRuntimeValidator();
  const flow = makeFlow(makeStep("s2", "typo-identity"));
  const err = await validator.validateStepIdentities(flow, (_id: string) => Promise.resolve(false));
  assertStringIncludes(err ?? "", "s2");
  assertStringIncludes(err ?? "", "typo-identity");
});

Deno.test("FlowRuntimeValidator.validateStepIdentities passes for a strategy-forced step whose identity resolves", async () => {
  const validator = new FlowRuntimeValidator();
  const step = makeStep("s1", "senior-coder");
  step.strategy = ExecutionStrategyName.REACT;
  const flow = makeFlow(step);
  const err = await validator.validateStepIdentities(flow, (id: string) => Promise.resolve(id === "senior-coder"));
  assertEquals(err, null);
});

Deno.test("FlowRuntimeValidator.validateStepIdentities rejects a strategy-forced step whose identity does not exist", async () => {
  const validator = new FlowRuntimeValidator();
  const step = makeStep("s1", "typo-identity");
  step.strategy = ExecutionStrategyName.CLI_DELEGATE;
  const flow = makeFlow(step);
  const err = await validator.validateStepIdentities(flow, (_id: string) => Promise.resolve(false));
  assertStringIncludes(err ?? "", "s1");
  assertStringIncludes(err ?? "", "typo-identity");
});

Deno.test("FlowRuntimeValidator.validateStepIdentities covers hand-off targets (dependsOn next step)", async () => {
  const validator = new FlowRuntimeValidator();
  const first = makeStep("s1", "senior-coder");
  const next = makeStep("s2", "missing-handoff-identity");
  next.dependsOn = ["s1"];
  const flow = makeFlow(first);
  flow.steps = [first, next];
  const err = await validator.validateStepIdentities(flow, (id: string) => Promise.resolve(id === "senior-coder"));
  assertStringIncludes(err ?? "", "s2");
});

Deno.test("FlowValidatorImpl rejects a flow whose step identity is absent from a real blueprint catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa-flow-id-" });
  try {
    await Deno.mkdir(`${dir}/Agents`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/Agents/senior-coder.md`,
      `---\nidentity_id: "senior-coder"\nname: "Senior Coder"\ncapabilities: ["react"]\n---\n`,
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
    identity: "typo-identity"
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
    assertStringIncludes(result.error ?? "", "typo-identity");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl accepts a flow whose step identities exist in the catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa-flow-id-" });
  try {
    await Deno.mkdir(`${dir}/Agents`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/Agents/senior-coder.md`,
      `---\nidentity_id: "senior-coder"\nname: "Senior Coder"\ncapabilities: ["react"]\n---\n`,
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
    identity: "senior-coder"
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
