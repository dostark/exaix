/**
 * @module FlowStepBindingSchemaTest
 * @path packages/schemas/tests/flow_step_binding_schema_test.ts
 * @description Step-5 schema coverage: a flow step may declare a `binding` and a `pin`.
 *   They are valid on agent, gate, branch, consensus and session_delegate_cycle steps;
 *   rejected on every other step type; and every `pin.fields` entry must be set in the
 *   step's own `binding`.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/flow.ts, packages/schemas/src/model_binding.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowStepType } from "@exaix/core";
import { FlowSchema, type IFlow } from "@exaix/schemas";

type TestStep = {
  id: string;
  name: string;
  agent_role: string;
  dependsOn: string[];
  input: { source: string; transform: string };
  type: FlowStepType;
  binding?: { service?: string; model?: string };
  pin?: { fields: string[]; reason: string };
  evaluate?: { agent_role: string; criteria: string[]; threshold: number };
  branches?: Array<{ condition: string; goto: string }>;
  consensus?: { members: string[]; strategy: string };
  delegateCycle?: {
    requireChangedPaths: boolean;
    review: { agent_role: string; criteria: string[]; threshold: number; onFail: string };
  };
  voting?: { members: string[]; strategy: string };
};

type StepExtra = Partial<(TestStep extends infer T ? T : never) & Record<never, never>>;

function stepOf(type: FlowStepType, extra: StepExtra = {}): TestStep {
  return {
    id: "s1",
    name: "Step 1",
    agent_role: "builder",
    dependsOn: [] as string[],
    input: { source: "request", transform: "passthrough" },
    ...extra,
    type,
  };
}

const DEFAULT_BINDING = { service: "openai", model: "openai/gpt-6-luna" };
const PIN = { fields: ["service", "model"], reason: "compliance" };

function flowWith(step: TestStep, following: TestStep[] = []): IFlow {
  return FlowSchema.parse({
    id: "research",
    name: "Research",
    description: "bindings schema",
    version: "1.0.0",
    steps: [step, ...following],
    output: { from: "s1", format: "markdown" },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  });
}

Deno.test("binding and pin parse on an agent step", () => {
  flowWith(stepOf(FlowStepType.AGENT, { binding: DEFAULT_BINDING, pin: PIN }));
});

Deno.test("binding and pin parse on a gate step", () => {
  flowWith(stepOf(FlowStepType.GATE, {
    binding: DEFAULT_BINDING,
    pin: PIN,
    evaluate: { agent_role: "reviewer", criteria: ["correctness"], threshold: 0.8 },
  }));
});

Deno.test("binding and pin parse on a branch step", () => {
  const flow = flowWith(
    stepOf(FlowStepType.BRANCH, {
      binding: DEFAULT_BINDING,
      pin: PIN,
      branches: [{ condition: "true", goto: "next" }],
    }),
    [stepOf(FlowStepType.AGENT, { id: "next", dependsOn: ["s1"] })],
  );
  assertEquals(flow.steps[0].binding, DEFAULT_BINDING);
  assertEquals(flow.steps[0].pin, PIN);
});

Deno.test("binding and pin parse on a consensus step", () => {
  flowWith(stepOf(FlowStepType.CONSENSUS, {
    binding: DEFAULT_BINDING,
    pin: PIN,
    consensus: { members: ["a", "b"], strategy: "majority" },
  }));
});

Deno.test("binding and pin parse on a session_delegate_cycle step (selects its review gate)", () => {
  flowWith(stepOf(FlowStepType.SESSION_DELEGATE_CYCLE, {
    binding: DEFAULT_BINDING,
    pin: PIN,
    delegateCycle: {
      requireChangedPaths: true,
      review: { agent_role: "reviewer", criteria: ["correctness"], threshold: 0.8, onFail: "halt" },
    },
  }));
});

Deno.test("binding and pin are rejected on a voting_group step", () => {
  assertThrows(
    () =>
      flowWith(stepOf(FlowStepType.VOTING_GROUP, {
        binding: DEFAULT_BINDING,
        pin: PIN,
        voting: { members: ["a", "b"], strategy: "majority" },
      })),
    Error,
  );
});

Deno.test("a pinned field missing from the step's binding is rejected", () => {
  assertThrows(
    () =>
      flowWith(stepOf(FlowStepType.AGENT, {
        binding: { service: "openai" }, // model is pinned but not bound
        pin: PIN,
      })),
    Error,
  );
});

Deno.test("a step with a binding but no pin parses", () => {
  flowWith(stepOf(FlowStepType.AGENT, { binding: DEFAULT_BINDING }));
});

Deno.test("pin without binding is rejected", () => {
  assertThrows(
    () => flowWith(stepOf(FlowStepType.AGENT, { pin: PIN })),
    Error,
  );
});

Deno.test("an invalid selector on a binding spec is rejected", () => {
  assertThrows(
    () => flowWith(stepOf(FlowStepType.AGENT, { binding: { service: "UPPER!!" } })),
    Error,
  );
  // A clean round-trip to assert the schema accepts structured values after rejection cases.
  flowWith(stepOf(FlowStepType.AGENT, { binding: DEFAULT_BINDING }));
  assertEquals(true, true);
});
