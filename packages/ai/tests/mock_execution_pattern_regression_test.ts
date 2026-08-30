/**
 * @module MockExecutionPatternRegressionTest
 * @path packages/ai/tests/mock_execution_pattern_regression_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Regression tests for the MockLLMProvider, ensuring consistent generation
 * of planning and execution responses based on structured prompt patterns.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";

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

  const { content: responseText } = await provider.generate(planningPrompt);

  // Should contain planning response with <content> and plan JSON
  assertStringIncludes(responseText, TAG_THOUGHT);
  assertStringIncludes(responseText, TAG_CONTENT);
  assertStringIncludes(responseText, '"title"');
  assertStringIncludes(responseText, KEY_STEPS);

  // Should NOT contain execution actions
  assertEquals(responseText.includes(TAG_ACTIONS), false, "Planning response should not contain <actions>");
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

  const { content: responseText } = await provider.generate(executionPrompt);

  // Should contain execution response with <actions>
  assertStringIncludes(responseText, TAG_THOUGHT);
  assertStringIncludes(responseText, TAG_ACTIONS);

  // Should contain tool calls (JSON array)
  assertStringIncludes(responseText, KEY_TOOL);
  assertStringIncludes(responseText, KEY_PARAMS);

  // Should NOT contain planning JSON
  assertEquals(responseText.includes(KEY_STEPS), false, "Execution response should not contain plan steps");
  assertEquals(responseText.includes(TAG_CONTENT), false, "Execution response should use <actions> not <content>");
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

  const { content: responseText } = await provider.generate(writePrompt);

  // Should generate write_file action
  assertStringIncludes(responseText, TOOL_WRITE_FILE);
  assertStringIncludes(responseText, '"path":');
  assertStringIncludes(responseText, '"content":');
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

  const { content: responseText } = await provider.generate(executionPrompt);

  // The key fix: should generate <actions> (not planning <content>)
  // The specific tool doesn't matter as much as generating actions vs planning
  assertStringIncludes(responseText, TAG_ACTIONS);
  assertStringIncludes(responseText, KEY_TOOL);
  assertStringIncludes(responseText, KEY_PARAMS);

  // Should NOT be a planning response
  assertEquals(responseText.includes(KEY_STEPS), false, "Should not contain planning steps");
  assertEquals(responseText.includes(TAG_CONTENT), false, "Should use <actions> not <content>");
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
    const { content: responseText } = await provider.generate(prompt);

    assertStringIncludes(
      responseText,
      TAG_ACTIONS,
      `Prompt "${prompt}" should generate execution response with <actions>`,
    );
    assertEquals(
      responseText.includes(TAG_CONTENT),
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
  const { content: planningResponseText } = await provider.generate(planningPrompt);

  assertStringIncludes(planningResponseText, TAG_CONTENT);
  assertStringIncludes(planningResponseText, KEY_STEPS);

  // Same keywords in execution context
  const executionPrompt = "You are an autonomous coding agent executing Step 1: Create the file";
  const { content: executionResponseText } = await provider.generate(executionPrompt);

  assertStringIncludes(executionResponseText, TAG_ACTIONS);
  assertEquals(executionResponseText.includes(KEY_STEPS), false);
});

// A flow step's userPrompt runs through mergeAsContext (core/func/transforms.ts:37), which
// prefixes each section with a `## Step N` header — a shape indistinguishable from the
// execution pattern's /Step \d+/i match, so a flow step could be misread as plan execution.

/** A flow step's prompt is the system prompt followed by merged context; the `## Step N`
 * header appears mid-prompt, never at the very start. */
const MERGE_AS_CONTEXT_PROMPT = `# Software Architect Agent

You design systems and document the reasoning behind each decision.

## Step 1
The API needs resource endpoints for requests and plans, with status transitions.`;

Deno.test("[flow-step] a mergeAsContext prompt yields content, not actions", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });

  const response = await provider.generate(MERGE_AS_CONTEXT_PROMPT);

  assertStringIncludes(response.content, TAG_CONTENT, "a flow step must produce content for the next step");
  assertEquals(response.content.includes(TAG_ACTIONS), false, "a flow step is not a plan-execution turn");
});

Deno.test("[flow-step] a mergeAsContext prompt keeping its original title still yields content", async () => {
  // mergeAsContext lifts a leading `# Title` above the step headers, so the prompt can start
  // with the request's own heading instead of a `## Step N` header.
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });

  const response = await provider.generate(`# Design the REST interface\n\n${MERGE_AS_CONTEXT_PROMPT}`);

  assertStringIncludes(response.content, TAG_CONTENT);
});

Deno.test("[flow-step] the flow-step response parses as a plan, so the final step's output validates", async () => {
  // The last step's content becomes the flow's aggregated output, which RequestProcessor hands
  // to plan validation — so the payload has to be a well-formed plan, not arbitrary prose.
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });

  const response = await provider.generate(MERGE_AS_CONTEXT_PROMPT);
  const content = response.content.split(TAG_CONTENT)[1].split("</content>")[0];

  const parsed = JSON.parse(content) as { steps?: { step: number; title: string }[] };
  assertEquals(Array.isArray(parsed.steps), true, "the aggregated flow output must validate as a plan");
});

Deno.test("[flow-step] genuine plan-execution prompts still yield actions", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });

  const response = await provider.generate("Execution Context: Performing step 2. Action required: implement the fix.");

  assertStringIncludes(response.content, TAG_ACTIONS, "the execution path must be unaffected");
});

Deno.test("[flow-step] a plan-execution prompt embedding `## Step N` headers still yields actions", async () => {
  // The regression this guards: plan steps render as `## Step N` headers too, so an
  // execution prompt can look like merged flow context. A prior fix matched the header alone
  // and hijacked execution, surfacing as a misleading "no actions generated" error.
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });

  const prompt = `You are executing a plan.

Execution Context: request-abc

## Step 1
Create the file.

## Step 2
Verify it.

Action required: implement step 1.`;

  const response = await provider.generate(prompt);

  assertStringIncludes(response.content, TAG_ACTIONS, "execution must not be misread as a flow step");
  assertEquals(response.content.includes(TAG_CONTENT), false);
});

// `recorded` is the default strategy and silently pattern-matches when no fixtures are
// configured, so isPatternFallback and strict-mode fixture checks below guard against tests
// silently degrading into unverified pattern replay.

Deno.test("[recorded] a provider with no fixtures reports that it is pattern-matching", () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings: [] });
  assertEquals(provider.isPatternFallback, true, "an unrecorded provider must not claim to replay");
});

Deno.test("[recorded] a provider with fixtures does not claim pattern fallback", () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [{
      promptHash: "abc",
      promptPreview: "anything",
      response: "<thought>t</thought><content>{}</content>",
      model: "m",
      tokens: { input: 1, output: 1 },
      recordedAt: new Date().toISOString(),
    }],
  });
  assertEquals(provider.isPatternFallback, false);
});

Deno.test("[recorded] strict mode refuses a prompt with no recording instead of guessing", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [{
      promptHash: "nonmatching",
      promptPreview: "unrelated",
      response: "<thought>t</thought><content>{}</content>",
      model: "m",
      tokens: { input: 1, output: 1 },
      recordedAt: new Date().toISOString(),
    }],
    strictRecordings: true,
  });

  let threw = false;
  try {
    await provider.generate("a prompt nobody recorded");
  } catch (error) {
    threw = true;
    assertStringIncludes(String(error), "strict recordings are enabled");
  }
  assertEquals(threw, true, "a fixture hole must surface, not be answered from a regex");
});
