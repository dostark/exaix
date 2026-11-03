/**
 * @module FlowDependencyResolverTest
 * @path packages/flow/tests/dependency_resolver_test.ts
 * @related-files []
 * @architectural-layer Flow
 * @description TODO: Add description
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowInputSource } from "@exaix/core";

import { DependencyResolver, FlowValidationError } from "@exaix/flow";
import type { IFlowStep, IFlowStepInput } from "@exaix/schemas/flow.ts";

const defaultStepProps = {
  agent_role: "agent1",
  input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
  retry: { maxAttempts: 1, backoffMs: 1000 },
};

function createStep(id: string, dependsOn: string[] = [], overrides: Partial<IFlowStepInput> = {}): IFlowStepInput {
  return {
    id,
    name: `Step ${id}`,
    dependsOn,
    ...defaultStepProps,
    ...overrides,
  };
}

// Test DependencyResolver class
Deno.test("DependencyResolver: handles empty flow", () => {
  const resolver = new DependencyResolver([]);
  assertEquals(resolver.topologicalSort(), []);
  assertEquals(resolver.groupIntoWaves(), []);
});

Deno.test("DependencyResolver: handles single step with no dependencies", () => {
  const steps = [createStep("step1")];
  const resolver = new DependencyResolver(steps as IFlowStep[]);
  assertEquals(resolver.topologicalSort(), ["step1"]);
  assertEquals(resolver.groupIntoWaves(), [["step1"]]);
});

Deno.test("DependencyResolver: handles linear chain", () => {
  const steps = [
    createStep("step1"),
    createStep("step2", ["step1"], {
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
    }),
    createStep("step3", ["step2"], {
      input: { source: FlowInputSource.STEP, stepId: "step2", transform: "passthrough" },
    }),
  ];

  const resolver = new DependencyResolver(steps as IFlowStep[]);
  assertEquals(resolver.topologicalSort(), ["step1", "step2", "step3"]);
  assertEquals(resolver.groupIntoWaves(), [["step1"], ["step2"], ["step3"]]);
});

Deno.test("DependencyResolver: handles parallel steps", () => {
  const steps = [
    createStep("start"),
    createStep("parallel1", ["start"], {
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
    }),
    createStep("parallel2", ["start"], {
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
    }),
    createStep("end", ["parallel1", "parallel2"], {
      input: { source: FlowInputSource.AGGREGATE, transform: "combine" },
    }),
  ];

  const resolver = new DependencyResolver(steps as IFlowStep[]);
  const topoOrder = resolver.topologicalSort();

  assertEquals(topoOrder[0], "start");
  assertEquals(topoOrder[topoOrder.length - 1], "end");
  const topoOrderIncludesParallel1: boolean = topoOrder.includes("parallel1");
  assertEquals(topoOrderIncludesParallel1, true, "topoOrder should include 'parallel1'");
  const topoOrderIncludesParallel2: boolean = topoOrder.includes("parallel2");
  assertEquals(topoOrderIncludesParallel2, true, "topoOrder should include 'parallel2'");

  const waves = resolver.groupIntoWaves();
  assertEquals(waves.length, 3);
  assertEquals(waves[0], ["start"]);
  const wavesItemIncludesParallel1: boolean = waves[1].includes("parallel1");
  assertEquals(wavesItemIncludesParallel1, true, "wavesItem should include 'parallel1'");
  const wavesItemIncludesParallel2: boolean = waves[1].includes("parallel2");
  assertEquals(wavesItemIncludesParallel2, true, "wavesItem should include 'parallel2'");
  assertEquals(waves[2], ["end"]);
});

Deno.test("DependencyResolver: detects self-referencing cycle", () => {
  const steps = [createStep("step1", ["step1"])];
  const resolver = new DependencyResolver(steps as IFlowStep[]);
  assertThrows(
    () => resolver.topologicalSort(),
    FlowValidationError,
    "Cycle detected in dependency graph: step1 -> step1",
  );
});

Deno.test("DependencyResolver: detects simple cycle", () => {
  const steps = [
    createStep("step1", ["step2"]),
    createStep("step2", ["step1"]),
  ];

  const resolver = new DependencyResolver(steps as IFlowStep[]);
  assertThrows(
    () => resolver.topologicalSort(),
    FlowValidationError,
    "Cycle detected in dependency graph: step1 -> step2 -> step1",
  );
});

Deno.test("DependencyResolver: detects complex cycle", () => {
  const steps = [
    createStep("a", ["c"]),
    createStep("b", ["a"], { input: { source: FlowInputSource.STEP, stepId: "a", transform: "passthrough" } }),
    createStep("c", ["b"], { input: { source: FlowInputSource.STEP, stepId: "b", transform: "passthrough" } }),
  ];

  const resolver = new DependencyResolver(steps as IFlowStep[]);
  assertThrows(
    () => resolver.topologicalSort(),
    FlowValidationError,
    "Cycle detected in dependency graph: a -> b -> c -> a",
  );
});

Deno.test("DependencyResolver: handles diamond pattern", () => {
  const steps = [
    createStep("start"),
    createStep("branch1", ["start"], {
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
    }),
    createStep("branch2", ["start"], {
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
    }),
    createStep("merge", ["branch1", "branch2"], { input: { source: FlowInputSource.AGGREGATE, transform: "combine" } }),
  ];

  const resolver = new DependencyResolver(steps as IFlowStep[]);
  const topoOrder = resolver.topologicalSort();
  assertEquals(topoOrder[0], "start");
  assertEquals(topoOrder[topoOrder.length - 1], "merge");

  const waves = resolver.groupIntoWaves();
  assertEquals(waves.length, 3);
  assertEquals(waves[0], ["start"]);
  const wavesItemIncludesBranch1: boolean = waves[1].includes("branch1");
  assertEquals(wavesItemIncludesBranch1, true, "wavesItem should include 'branch1'");
  const wavesItemIncludesBranch2: boolean = waves[1].includes("branch2");
  assertEquals(wavesItemIncludesBranch2, true, "wavesItem should include 'branch2'");
  assertEquals(waves[2], ["merge"]);
});

Deno.test("DependencyResolver: throws error for invalid dependency", () => {
  const steps = [createStep("step1", ["nonexistent"])];

  assertThrows(
    () => new DependencyResolver(steps as IFlowStep[]),
    FlowValidationError,
    "Dependency 'nonexistent' not found in step definitions",
  );
});

Deno.test("DependencyResolver: handles all parallel steps", () => {
  const steps = [
    createStep("step1"),
    createStep("step2"),
    createStep("step3"),
  ];

  const resolver = new DependencyResolver(steps as IFlowStep[]);
  const waves = resolver.groupIntoWaves();
  assertEquals(waves.length, 1);
  const wavesItemIncludesStep1: boolean = waves[0].includes("step1");
  assertEquals(wavesItemIncludesStep1, true, "wavesItem should include 'step1'");
  const wavesItemIncludesStep2: boolean = waves[0].includes("step2");
  assertEquals(wavesItemIncludesStep2, true, "wavesItem should include 'step2'");
  const wavesItemIncludesStep3: boolean = waves[0].includes("step3");
  assertEquals(wavesItemIncludesStep3, true, "wavesItem should include 'step3'");
});
