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

// ---------------------------------------------------------------------------
// Phase 142 Step 13 — a flow step's prompt must not be mistaken for plan execution.
//
// A flow step's userPrompt is its predecessor's output run through the step's transform, and
// `mergeAsContext` (core/func/transforms.ts:37) prefixes each section with a `## Step N`
// markdown header. The execution pattern matches /Step \d+/i, so every flow step past the
// first was answered with <actions> and no <content> — the step reported success with
// outputLength 0, aggregation produced nothing, and plan validation then failed on empty
// input. That is what held the flows pack at 0.500 with all 8 of api-design's steps "green".
// ---------------------------------------------------------------------------

/**
 * What the mock actually receives for a flow step: the identity's assembled system prompt,
 * then the merged context. The `## Step N` header is mid-prompt, never at its start — an
 * earlier fix anchored on the prompt's start and matched nothing in a real run.
 */
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
  // with the request's own heading rather than with `## Step 1`.
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
  // The regression this guards: a plan's steps render as `## Step N` markdown headers, so an
  // execution prompt carries the same header shape as merged flow context. A first fix matched
  // the header alone and hijacked execution, starving the ReAct loop — "No actions generated
  // in ReAct iteration" — which reads as an agent fault rather than a mock misclassification.
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

// ---------------------------------------------------------------------------
// Recorded replay must be honest about whether it replayed anything.
//
// `recorded` is the DEFAULT strategy, and with no fixtures configured the constructor
// silently substitutes default patterns — so every scenario run so far reported
// `provider: mock-recorded-<model>` while replaying nothing. Two guarantees make
// fixture-backed runs trustworthy: the provider says when it is really pattern-matching, and
// strict mode refuses a prompt it has no recording for instead of quietly answering from a
// regex. Without the second, a fixture set with holes degrades into the same silent
// misclassification that produced "No actions generated in ReAct iteration".
// ---------------------------------------------------------------------------

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
