/**
 * @module FlowValidateDynamicTest
 * @path packages/cli/tests/flow_validation_test.ts
 * @description Tests for CLI flow validation of dynamic step execution mode,
 * ensuring proper errors for write tools and warnings for missing configurations.
 * @architectural-layer Tests
 * @related-files [apps/exactl/src/commands/flow_commands.ts, "packages/core/src/types/constants.ts"]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import { McpToolName, READ_ONLY_TOOLS, WRITE_TOOLS } from "@exaix/mcp";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_VERSION } from "@exaix/core";
import { validateFlowForCli } from "@exaix/cli/flow_validation.ts";

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

function validateSingleDynamicStep(overrides: Partial<IFlowStep> = {}) {
  return validateFlowForCli(
    createFlow({
      steps: [
        createStep({
          id: "explore",
          execution_mode: FlowStepExecutionMode.DYNAMIC,
          ...overrides,
        }),
      ],
    }),
    WRITE_TOOLS,
    READ_ONLY_TOOLS,
  );
}

function assertValidationCounts(
  result: ReturnType<typeof validateFlowForCli>,
  valid: boolean,
  errorCount: number,
  warningCount?: number,
): void {
  assertEquals(result.valid, valid);
  assertEquals(result.errors.length, errorCount);
  if (warningCount !== undefined) {
    assertEquals(result.warnings.length, warningCount);
  }
}

Deno.test("validateFlowForCli: returns valid result for flow with no dynamic steps", () => {
  const flow = createFlow({
    steps: [
      createStep({ id: "step1", execution_mode: FlowStepExecutionMode.DECLARED }),
      createStep({ id: "step2", execution_mode: FlowStepExecutionMode.DECLARED }),
    ],
  });

  const result = validateFlowForCli(flow, WRITE_TOOLS, READ_ONLY_TOOLS);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateFlowForCli: returns error for dynamic step with write_file in permitted_tools", () => {
  const result = validateSingleDynamicStep({ permitted_tools: [McpToolName.WRITE_FILE] });

  assertValidationCounts(result, false, 1);
  assertStringIncludes(result.errors[0], '"write_file" is a write tool');
  assertStringIncludes(result.errors[0], "Dynamic steps may only use read-only tools");
});

for (
  const testCase of [
    {
      name: "validateFlowForCli: returns error for dynamic step with run_command in permitted_tools",
      permittedTools: [McpToolName.READ_FILE, McpToolName.RUN_COMMAND],
      expectedMessage: '"run_command" is a write tool',
    },
    {
      name: "validateFlowForCli: returns error for dynamic step with create_directory in permitted_tools",
      permittedTools: [McpToolName.CREATE_DIRECTORY],
      expectedMessage: '"create_directory" is a write tool',
    },
  ]
) {
  Deno.test(testCase.name, () => {
    const result = validateSingleDynamicStep({ permitted_tools: testCase.permittedTools });

    assertValidationCounts(result, false, 1);
    assertStringIncludes(result.errors[0], testCase.expectedMessage);
  });
}

Deno.test("validateFlowForCli: accepts dynamic step with only read-only tools", () => {
  const result = validateSingleDynamicStep({
    permitted_tools: [
      McpToolName.READ_FILE,
      McpToolName.LIST_DIRECTORY,
      McpToolName.SEARCH_FILES,
    ],
  });

  assertValidationCounts(result, true, 0);
});

for (
  const testCase of [
    {
      name: "validateFlowForCli: returns warning for dynamic step with no permitted_tools",
      overrides: { permitted_tools: undefined, timeout: 60000 },
      expectedMessages: ["no permitted_tools specified", "identity"],
    },
    {
      name: "validateFlowForCli: returns warning for dynamic step with empty permitted_tools",
      overrides: { permitted_tools: [], timeout: 60000 },
      expectedMessages: ["no permitted_tools specified"],
    },
    {
      name: "validateFlowForCli: returns warning for dynamic step with no timeout",
      overrides: { permitted_tools: [McpToolName.READ_FILE], timeout: undefined },
      expectedMessages: ["no timeout set for dynamic step", "max_iterations"],
    },
  ]
) {
  Deno.test(testCase.name, () => {
    const result = validateSingleDynamicStep(testCase.overrides);

    assertValidationCounts(result, true, 0, 1);
    for (const message of testCase.expectedMessages) {
      assertStringIncludes(result.warnings[0], message);
    }
  });
}

Deno.test("validateFlowForCli: no warning for dynamic step with timeout set", () => {
  const result = validateSingleDynamicStep({
    permitted_tools: [McpToolName.READ_FILE],
    timeout: 60000,
  });

  assertValidationCounts(result, true, 0, 0);
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

  const result = validateFlowForCli(flow, WRITE_TOOLS, READ_ONLY_TOOLS);

  assertValidationCounts(result, false, 1, 2);
  assertStringIncludes(result.errors[0], "bad-step");
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

  const result = validateFlowForCli(flow, WRITE_TOOLS, READ_ONLY_TOOLS);

  assertValidationCounts(result, true, 0, 0);
});
