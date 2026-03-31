/**
 * @module FlowValidatorExtendedTest
 * @path tests/flows/flow_validator_extended_test.ts
 * @description Targeted tests for Flow validation, ensuring robust enforcement of
 * required output configurations and wave-based execution constraints.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepType, StepExecutionMode } from "../../src/shared/enums.ts";
import { FlowValidatorImpl } from "../../src/services/flow/flow_validator.ts";
import { FlowLoader } from "../../src/flows/flow_loader.ts";
import type { IFlow, IFlowStep } from "../../src/shared/schemas/flow.ts";

/**
 * Mock FlowLoader that extends FlowLoader to allow controlling behavior without file system
 */
class MockFlowLoader extends FlowLoader {
  private flows: Map<string, IFlow | Error | "throw-non-error"> = new Map();
  private existingFlows: Set<string> = new Set();

  constructor() {
    super("/mock/flows");
  }

  setFlow(id: string, flow: IFlow | Error | "throw-non-error"): void {
    this.flows.set(id, flow);
    this.existingFlows.add(id);
  }

  setFlowExists(id: string, exists: boolean): void {
    if (exists) {
      this.existingFlows.add(id);
    } else {
      this.existingFlows.delete(id);
    }
  }

  override flowExists(flowId: string): Promise<boolean> {
    return Promise.resolve(this.existingFlows.has(flowId));
  }

  override loadFlow(flowId: string): Promise<IFlow> {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new Error(`IFlow as Flow '${flowId}' not found`);
    }
    if (flow === "throw-non-error") {
      throw "String error thrown";
    }
    if (flow instanceof Error) {
      throw flow;
    }
    return Promise.resolve(flow);
  }

  override loadAllFlows(): Promise<IFlow[]> {
    const flows: IFlow[] = [];
    for (const flow of this.flows.values()) {
      if (!(flow instanceof Error) && flow !== "throw-non-error") {
        flows.push(flow);
      }
    }
    return Promise.resolve(flows);
  }

  override listFlowIds(): Promise<string[]> {
    return Promise.resolve(Array.from(this.existingFlows));
  }
}

/**
 * Helper to create minimal valid step
 */
function createStep(id: string, identity: string, dependsOn: string[] = []): IFlowStep {
  return {
    id,
    name: `Step ${id}`,
    identity,
    type: FlowStepType.AGENT,
    execution_mode: StepExecutionMode.DECLARED,
    dependsOn,
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: 1000 },
  };
}

/**
 * Helper to create minimal valid flow
 */
function createFlow(
  id: string,
  steps: IFlowStep[],
  output?: { from: string; format: FlowOutputFormat },
): IFlow {
  const flow: IFlow = {
    id,
    name: `Flow ${id}`,
    description: `Description for ${id}`,
    version: "1.0.0",
    steps,
    output: output ?? { from: "default", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true, includeRequestCriteria: false },
  };
  return flow;
}

// ===== Tests for flow.output validation =====

Deno.test("FlowValidatorImpl: validates flow without output configuration", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("no-output", [createStep("s1", "agent1")]);
  (flow as Partial<typeof flow>).output = undefined;
  loader.setFlow("no-output", flow);

  const result = await validator.validateFlow("no-output");
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("FlowValidatorImpl: fails for flow with missing output.format", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("missing-format", [createStep("s1", "agent1")]);
  Object.assign(flow.output, { from: "s1" });
  (flow.output as Partial<typeof flow.output>).format = undefined;
  loader.setFlow("missing-format", flow);

  const result = await validator.validateFlow("missing-format");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "invalid output configuration");
});

Deno.test("FlowValidatorImpl: fails for flow with missing output.from", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("missing-from", [createStep("s1", "agent1")]);
  Object.assign(flow.output, { format: FlowOutputFormat.MARKDOWN });
  (flow.output as Partial<typeof flow.output>).from = undefined;
  loader.setFlow("missing-from", flow);

  const result = await validator.validateFlow("missing-from");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "invalid output configuration");
});

// ===== Tests for agent field validation =====

Deno.test("FlowValidatorImpl: fails for step with non-string agent", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const step = createStep("s1", "agent1");
  Object.defineProperty(step, "identity", { value: 123, writable: true, configurable: true });
  const flow = createFlow("non-string-agent", [step]);
  loader.setFlow("non-string-agent", flow);

  const result = await validator.validateFlow("non-string-agent");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "invalid identity");
});

Deno.test("FlowValidatorImpl: fails for step with null agent", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const step = createStep("s1", "agent1");
  Object.defineProperty(step, "identity", { value: null, writable: true, configurable: true });
  const flow = createFlow("null-agent", [step]);
  loader.setFlow("null-agent", flow);

  const result = await validator.validateFlow("null-agent");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "invalid identity");
});

Deno.test("FlowValidatorImpl: fails for step with undefined agent", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const step = createStep("s1", "agent1");
  (step as Partial<typeof step>).identity = undefined;
  const flow = createFlow("undefined-agent", [step]);
  loader.setFlow("undefined-agent", flow);

  const result = await validator.validateFlow("undefined-agent");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "invalid identity");
});

// ===== Tests for error handling =====

Deno.test("FlowValidatorImpl: handles loader error with Error instance", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  // Set up flow that will throw an Error
  const error = new Error("Flow parsing failed");
  loader.setFlow("error-flow", error);

  const result = await validator.validateFlow("error-flow");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "validation failed");
  assertStringIncludes(result.error ?? "", "Flow parsing failed");
});

Deno.test("FlowValidatorImpl: handles loader error with non-Error type", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  // Set up flow that will throw a non-Error
  loader.setFlow("string-error", "throw-non-error");

  const result = await validator.validateFlow("string-error");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "validation failed");
});

Deno.test("FlowValidatorImpl: handles loader error with 'Agent reference cannot be empty' message", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  // Set up flow that will throw the specific agent error
  const error = new Error("Agent reference cannot be empty");
  loader.setFlow("empty-agent-error", error);

  const result = await validator.validateFlow("empty-agent-error");
  assertEquals(result.valid, false);
  assertEquals(result.error, "IFlow 'empty-agent-error' has invalid agent");
});

// ===== Tests for steps array edge cases =====

Deno.test("FlowValidatorImpl: fails for flow with null steps", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("null-steps", [createStep("s1", "agent1")]);
  Object.defineProperty(flow, "steps", { value: null, writable: true, configurable: true });
  loader.setFlow("null-steps", flow);

  const result = await validator.validateFlow("null-steps");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "at least one step");
});

Deno.test("FlowValidatorImpl: fails for flow with undefined steps", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("undefined-steps", [createStep("s1", "agent1")]);
  (flow as Partial<typeof flow>).steps = undefined;
  loader.setFlow("undefined-steps", flow);

  const result = await validator.validateFlow("undefined-steps");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "at least one step");
});

// ===== Tests for multiple steps =====

Deno.test("FlowValidatorImpl: validates flow with multiple valid steps", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("multi-step", [
    createStep("s1", "agent1"),
    createStep("s2", "agent2", ["s1"]),
    createStep("s3", "agent3", ["s2"]),
  ], { from: "s3", format: FlowOutputFormat.MARKDOWN });
  loader.setFlow("multi-step", flow);

  const result = await validator.validateFlow("multi-step");
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("FlowValidatorImpl: fails when second step has invalid agent", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const step2 = createStep("s2", "agent2");
  (step2 as Partial<typeof step2>).identity = "";
  const flow = createFlow("second-invalid", [
    createStep("s1", "agent1"),
    step2,
  ]);
  loader.setFlow("second-invalid", flow);

  const result = await validator.validateFlow("second-invalid");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "step 's2'");
  assertStringIncludes(result.error ?? "", "invalid identity");
});

// ===== Tests for dependency validation edge cases =====

Deno.test("FlowValidatorImpl: handles dependency resolver throwing non-Error", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  // Create a flow with self-referential dependency to trigger cycle detection
  const flow = createFlow("self-ref", [
    createStep("s1", "agent1", ["s1"]),
  ]);
  loader.setFlow("self-ref", flow);

  const result = await validator.validateFlow("self-ref");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "invalid dependencies");
});

// ===== Tests for output.from references =====

Deno.test("FlowValidatorImpl: validates flow with output.from referencing last step", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("output-last", [
    createStep("s1", "agent1"),
    createStep("s2", "agent2", ["s1"]),
  ], { from: "s2", format: FlowOutputFormat.JSON });
  loader.setFlow("output-last", flow);

  const result = await validator.validateFlow("output-last");
  assertEquals(result.valid, true);
});

Deno.test("FlowValidatorImpl: validates flow with output.from referencing first step", async () => {
  const loader = new MockFlowLoader();
  const validator = new FlowValidatorImpl(loader, "blueprints");

  const flow = createFlow("output-first", [
    createStep("s1", "agent1"),
    createStep("s2", "agent2", ["s1"]),
  ], { from: "s1", format: FlowOutputFormat.MARKDOWN });
  loader.setFlow("output-first", flow);

  const result = await validator.validateFlow("output-first");
  assertEquals(result.valid, true);
});

// ===== Test for complete error path coverage =====

Deno.test("FlowValidatorImpl: outer catch handles unexpected errors", async () => {
  const brokenLoader = new MockFlowLoader();
  brokenLoader.setFlow("broken", new Error("Unexpected flowExists error"));
  const validator = new FlowValidatorImpl(brokenLoader, "blueprints");

  const result = await validator.validateFlow("broken");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "validation failed");
  assertStringIncludes(result.error ?? "", "Unexpected flowExists error");
});

Deno.test("FlowValidatorImpl: outer catch handles non-Error exceptions", async () => {
  const brokenLoader = new MockFlowLoader();
  const stringError = "String exception from flowExists";
  brokenLoader.setFlow("broken", Object.assign(new Error(stringError), { __isStringError: true }));
  const validator = new FlowValidatorImpl(brokenLoader, "blueprints");

  const result = await validator.validateFlow("broken");
  assertEquals(result.valid, false);
  assertStringIncludes(result.error ?? "", "validation failed");
  assertStringIncludes(result.error ?? "", "String exception from flowExists");
});
