/**
 * @module MockExecutionPatternRegressionTest
 * @path tests/mock_execution_pattern_regression_test.ts
 * @description Regression tests for the MockLLMProvider, ensuring consistent generation
 * of planning and execution responses based on structured prompt patterns.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { MockLLMProvider } from "../../../src/ai/providers/mock_llm_provider.ts";
import { MockStrategy } from "../../../src/shared/enums.ts";

const TAG_THOUGHT = "<thought>";
const TAG_CONTENT = "<content>";
const TAG_ACTIONS = "<actions>";
const KEY_STEPS = '"steps"';
const KEY_TOOL = '"tool":';
const KEY_PARAMS = '"params":';
const TOOL_WRITE_FILE = '"tool": "write_file"';

Deno.test("[regression] MockLLMProvider generates planning response for planning prompts", async () => {
  // Create mock provider with recorded strategy (uses pattern fallback)
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [], // No recordings, will fall back to patterns
  });

  // Planning prompt - requests a plan
  const planningPrompt = `
# Senior Software Engineer Agent

You are an expert software engineer. Create a plan for:

User request: "Add a hello world function to src/utils.ts"
`;

  const response = await provider.generate(planningPrompt);

  // Should contain planning response with <content> and plan JSON
  assertStringIncludes(response, TAG_THOUGHT);
  assertStringIncludes(response, TAG_CONTENT);
  assertStringIncludes(response, '"title"');
  assertStringIncludes(response, KEY_STEPS);

  // Should NOT contain execution actions
  assertEquals(response.includes(TAG_ACTIONS), false, "Planning response should not contain <actions>");
});

Deno.test("[regression] MockLLMProvider generates execution response for execution prompts", async () => {
  // Create mock provider with recorded strategy (uses pattern fallback)
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [], // No recordings, will fall back to patterns
  });

  // Execution prompt - indicates step execution
  const executionPrompt = `
You are an autonomous coding agent executing a plan.

Current Step: Step 3 - Implement Code
Description: Write the necessary code changes to implement the feature.

Context: User wants to add a hello world function

Execute this step now.
`;

  const response = await provider.generate(executionPrompt);

  // Should contain execution response with <actions>
  assertStringIncludes(response, TAG_THOUGHT);
  assertStringIncludes(response, TAG_ACTIONS);

  // Should contain tool calls (JSON array)
  assertStringIncludes(response, KEY_TOOL);
  assertStringIncludes(response, KEY_PARAMS);

  // Should NOT contain planning JSON
  assertEquals(response.includes(KEY_STEPS), false, "Execution response should not contain plan steps");
  assertEquals(response.includes(TAG_CONTENT), false, "Execution response should use <actions> not <content>");
});

Deno.test("[regression] MockLLMProvider execution pattern generates write_file action for write prompts", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const writePrompt = `
You are an autonomous coding agent executing a plan.

Step 5: Write the implementation file

Create src/hello.ts with the hello world function.
`;

  const response = await provider.generate(writePrompt);

  // Should generate write_file action
  assertStringIncludes(response, TOOL_WRITE_FILE);
  assertStringIncludes(response, '"path":');
  assertStringIncludes(response, '"content":');
});

Deno.test("[regression] MockLLMProvider execution pattern generates actions for execution prompts", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const executionPrompt = `
You are an autonomous coding agent executing a plan.

Step 2: Analyze the current implementation

Read src/index.ts to understand the structure.
`;

  const response = await provider.generate(executionPrompt);

  // The key fix: should generate <actions> (not planning <content>)
  // The specific tool doesn't matter as much as generating actions vs planning
  assertStringIncludes(response, TAG_ACTIONS);
  assertStringIncludes(response, KEY_TOOL);
  assertStringIncludes(response, KEY_PARAMS);

  // Should NOT be a planning response
  assertEquals(response.includes(KEY_STEPS), false, "Should not contain planning steps");
  assertEquals(response.includes(TAG_CONTENT), false, "Should use <actions> not <content>");
});

Deno.test("[regression] MockLLMProvider pattern recognition handles 'Step N' format", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  // Various step formats should all trigger execution pattern
  const prompts = [
    "You are executing Step 1 of the plan",
    "Now execute step 2",
    "Step 3: Implement the feature",
  ];

  for (const prompt of prompts) {
    const response = await provider.generate(prompt);

    assertStringIncludes(
      response,
      TAG_ACTIONS,
      `Prompt "${prompt}" should generate execution response with <actions>`,
    );
    assertEquals(
      response.includes(TAG_CONTENT),
      false,
      `Prompt "${prompt}" should not generate planning response with <content>`,
    );
  }
});

Deno.test("[regression] MockLLMProvider distinguishes execution from planning keywords", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  // Planning keywords (implement, add, create) in planning context
  const planningPrompt = "Create a plan to implement the new feature";
  const planningResponse = await provider.generate(planningPrompt);

  assertStringIncludes(planningResponse, TAG_CONTENT);
  assertStringIncludes(planningResponse, KEY_STEPS);

  // Same keywords in execution context
  const executionPrompt = "You are an autonomous coding agent executing Step 1: Create the file";
  const executionResponse = await provider.generate(executionPrompt);

  assertStringIncludes(executionResponse, TAG_ACTIONS);
  assertEquals(executionResponse.includes(KEY_STEPS), false);
});
