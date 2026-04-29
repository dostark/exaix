/**
 * @module FlowValidateDynamicTest
 * @path tests/cli/flow_validate_dynamic_test.ts
 * @description Tests for CLI flow validation of dynamic step execution mode,
 * ensuring proper errors for write tools and warnings for missing configurations.
 * @architectural-layer Tests
 * * @related-files [src/cli/commands/flow_commands.ts, src/shared/constants.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_VERSION } from "@exaix/core";

/**
 * Helper to create minimal valid step
 */
function createStep(overrides: Partial<IFlowStep> = {}): IFlowStep {
  return {
    id: "test-step",
    name: "Test Step",
    identity: "test-agent",
    type: FlowStepType.AGENT,
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: 1000 },
    ...overrides,
  } as IFlowStep;
}

/**
 * Helper to create minimal valid flow
 */
function createFlow(overrides: Partial<IFlow> = {}): IFlow {
  return {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [],
    output: { from: "test-step", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true, includeRequestCriteria: false },
    ...overrides,
  } as IFlow;
}

/**
 * Import the validation function - this will fail until implemented
 */
import { validateFlowForCli } from "../../src/cli/flow_validation.ts";

Deno.test("validateFlowForCli: returns valid result for flow with no dynamic steps", () => {
  const flow = createFlow({
    steps: [
      createStep({ id: "step1", execution_mode: FlowStepExecutionMode.DECLARED }),
      createStep({ id: "step2", execution_mode: FlowStepExecutionMode.DECLARED }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateFlowForCli: returns error for dynamic step with write_file in permitted_tools", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.WRITE_FILE],
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertStringIncludes(result.errors[0], '"write_file" is a write tool');
  assertStringIncludes(result.errors[0], "Dynamic steps may only use read-only tools");
});

Deno.test("validateFlowForCli: returns error for dynamic step with run_command in permitted_tools", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.READ_FILE, McpToolName.RUN_COMMAND],
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertStringIncludes(result.errors[0], '"run_command" is a write tool');
});

Deno.test("validateFlowForCli: returns error for dynamic step with create_directory in permitted_tools", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.CREATE_DIRECTORY],
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertStringIncludes(result.errors[0], '"create_directory" is a write tool');
});

Deno.test("validateFlowForCli: accepts dynamic step with only read-only tools", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [
          McpToolName.READ_FILE,
          McpToolName.LIST_DIRECTORY,
          McpToolName.SEARCH_FILES,
        ],
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("validateFlowForCli: returns warning for dynamic step with no permitted_tools", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: undefined,
        timeout: 60000, // Set timeout to isolate permitted_tools warning
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertStringIncludes(result.warnings[0], "no permitted_tools specified");
  assertStringIncludes(result.warnings[0], "identity");
});

Deno.test("validateFlowForCli: returns warning for dynamic step with empty permitted_tools", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [],
        timeout: 60000, // Set timeout to isolate permitted_tools warning
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertStringIncludes(result.warnings[0], "no permitted_tools specified");
});

Deno.test("validateFlowForCli: returns warning for dynamic step with no timeout", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.READ_FILE],
        timeout: undefined,
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertStringIncludes(result.warnings[0], "no timeout set for dynamic step");
  assertStringIncludes(result.warnings[0], "max_iterations");
});

Deno.test("validateFlowForCli: no warning for dynamic step with timeout set", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "explore",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.READ_FILE],
        timeout: 60000,
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateFlowForCli: multiple errors and warnings for complex flow", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "bad-step",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.WRITE_FILE],
        timeout: undefined,
      }),
      createStep({
        id: "unconfigured-step",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: undefined,
        timeout: 30000,
      }),
      createStep({
        id: "good-step",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.READ_FILE],
        timeout: 60000,
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertStringIncludes(result.errors[0], "bad-step");
  assertEquals(result.warnings.length, 2);
});

Deno.test("validateFlowForCli: handles mixed declared and dynamic steps", () => {
  const flow = createFlow({
    steps: [
      createStep({
        id: "declared-step",
        execution_mode: FlowStepExecutionMode.DECLARED,
        permitted_tools: [McpToolName.WRITE_FILE], // Allowed in declared mode
      }),
      createStep({
        id: "dynamic-step",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [McpToolName.READ_FILE],
        timeout: 60000,
      }),
    ],
  });

  const result = validateFlowForCli(flow);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});
