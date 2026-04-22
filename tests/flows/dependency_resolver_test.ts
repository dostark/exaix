/**
 * @module FlowDependencyResolverTest
 * @path tests/flows/dependency_resolver_test.ts
 * @description Validates the DAG-based dependency resolution for complex workflows, ensuring
 * circular dependency detection and optimal wave-based parallel step grouping.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FlowInputSource } from "../../src/shared/enums.ts";

import { DependencyResolver, FlowValidationError } from "../../src/flows/dependency_resolver.ts";
import type { IFlowStep, IFlowStepInput } from "@exaix/schemas/flow.ts";

const defaultStepProps = {
  identity: "agent1",
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
  assertEquals(topoOrder.includes("parallel1"), true);
  assertEquals(topoOrder.includes("parallel2"), true);

  const waves = resolver.groupIntoWaves();
  assertEquals(waves.length, 3);
  assertEquals(waves[0], ["start"]);
  assertEquals(waves[1].includes("parallel1"), true);
  assertEquals(waves[1].includes("parallel2"), true);
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
  assertEquals(waves[1].includes("branch1"), true);
  assertEquals(waves[1].includes("branch2"), true);
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
  assertEquals(waves[0].includes("step1"), true);
  assertEquals(waves[0].includes("step2"), true);
  assertEquals(waves[0].includes("step3"), true);
});
