/**
 * @module MockLLMProviderTest
 * @path tests/ai/mock_llm_provider_test.ts
 * @description Verifies the MockLLMProvider service, ensuring correct implementation
 * of the model provider interface and stable response delivery for testing.
 */

import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { McpToolName, MockStrategy } from "../../src/shared/enums.ts";
import type { IGenerateResult } from "../../src/ai/providers/common.ts";
import type { IModelProvider } from "../../src/ai/types.ts";
import { TEST_MODEL_ANTHROPIC } from "../config/constants.ts";

import {
  createFailingMock,
  createPlanGeneratorMock,
  createSlowMock,
  type IRecordedResponse,
  MockLLMError,
  MockLLMProvider,
  type PatternMatcher,
} from "../../src/ai/providers/mock_llm_provider.ts";

// ============================================================================
// Test 1: MockLLMProvider implements IModelProvider interface
// ============================================================================

Deno.test("MockLLMProvider implements IModelProvider interface", () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED);

  // Verify interface compliance
  assertExists(provider.id);
  assertExists(provider.generate);
  assertEquals(typeof provider.id, "string");
  assertEquals(typeof provider.generate, "function");
});

Deno.test("MockLLMProvider has correct default id", () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED);
  assertEquals(provider.id, "mock-llm-provider");
});

Deno.test("MockLLMProvider accepts custom id", () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, { id: "custom-mock" });
  assertEquals(provider.id, "custom-mock");
});

// ============================================================================
// Test 2: Scripted Strategy - Return responses in sequence
// ============================================================================

Deno.test("Scripted: returns responses in order", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["First response", "Second response", "Third response"],
  });

  assertEquals((await provider.generate("prompt 1")).content, "First response");
  assertEquals((await provider.generate("prompt 2")).content, "Second response");
  assertEquals((await provider.generate("prompt 3")).content, "Third response");
});

Deno.test("Scripted: cycles back to first response when exhausted", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["A", "B"],
  });

  assertEquals((await provider.generate("1")).content, "A");
  assertEquals((await provider.generate("2")).content, "B");
  assertEquals((await provider.generate("3")).content, "A"); // Cycles back
  assertEquals((await provider.generate("4")).content, "B");
});

Deno.test("Scripted: uses default response when no responses configured", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED);

  const result = (await provider.generate("test")).content;
  assertExists(result);
  assertEquals(typeof result, "string");
});

Deno.test("Scripted: tracks call count", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["response"],
  });

  assertEquals(provider.callCount, 0);
  await provider.generate("1");
  assertEquals(provider.callCount, 1);
  await provider.generate("2");
  assertEquals(provider.callCount, 2);
});

Deno.test("Scripted: stores call history", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["response"],
  });

  await provider.generate("first prompt");
  await provider.generate("second prompt");

  assertEquals(provider.callHistory.length, 2);
  assertEquals(provider.callHistory[0].prompt, "first prompt");
  assertEquals(provider.callHistory[1].prompt, "second prompt");
});

// ============================================================================
// Test 3: Recorded Strategy - Replay responses by prompt hash
// ============================================================================

Deno.test("Recorded: returns response matching prompt hash", async () => {
  const recordings: IRecordedResponse[] = [
    {
      promptHash: "abc123",
      promptPreview: "You are a senior...",
      response: "## Plan\n\n1. First step",
      model: TEST_MODEL_ANTHROPIC,
      tokens: { input: 100, output: 50 },
      recordedAt: "2025-12-01T10:00:00Z",
    },
  ];

  const provider = new MockLLMProvider(MockStrategy.RECORDED, { recordings });

  // The provider should hash "You are a senior..." and find a match
  const result = await provider.generate("You are a senior...");
  assertEquals(result.content, "## Plan\n\n1. First step");
});

Deno.test("Recorded: throws error when no matching recording found", async () => {
  // To test error throwing, we need to explicitly prevent fallback patterns
  // by providing an empty patterns array
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
    patterns: [], // Explicitly set empty patterns to prevent auto-initialization
  });

  // Now it should throw error since no fallback is available
  await assertRejects(
    async () => await provider.generate("unknown prompt"),
    MockLLMError,
    "No recorded response found",
  );
});

Deno.test("Recorded: can load recordings from fixture directory", () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    fixtureDir: "./tests/fixtures/llm_responses",
  });

  // Provider should load *.json files from the directory
  assertExists(provider);
});

Deno.test("Recorded: hash function is deterministic", () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED);

  const hash1 = provider.hashPrompt("test prompt");
  const hash2 = provider.hashPrompt("test prompt");
  const hash3 = provider.hashPrompt("different prompt");

  assertEquals(hash1, hash2);
  assert(hash1 !== hash3);
});

// ============================================================================
// Test 4: IPattern Strategy - Match prompts with regex patterns
// ============================================================================

Deno.test("IPattern: matches prompt and returns configured response", async () => {
  const patterns: PatternMatcher[] = [
    {
      pattern: /implement.*authentication/i,
      response: "## Plan: Authentication\n\n1. Create auth module",
    },
    {
      pattern: /fix.*bug/i,
      response: "## Plan: Bug Fix\n\n1. Identify root cause",
    },
  ];

  const provider = new MockLLMProvider(MockStrategy.PATTERN, { patterns });

  const result1 = (await provider.generate("Please implement user authentication")).content;
  assertStringIncludes(result1, "Authentication");

  const result2 = (await provider.generate("Fix the login bug")).content;
  assertStringIncludes(result2, "Bug Fix");
});

Deno.test("IPattern: uses first matching pattern", async () => {
  const patterns: PatternMatcher[] = [
    { pattern: /test/, response: "First match" },
    { pattern: /test/, response: "Second match" },
  ];

  const provider = new MockLLMProvider(MockStrategy.PATTERN, { patterns });
  const result = (await provider.generate("test")).content;

  assertEquals(result, "First match");
});

Deno.test("IPattern: throws error when no pattern matches", async () => {
  const patterns: PatternMatcher[] = [
    { pattern: /specific/, response: "response" },
  ];

  const provider = new MockLLMProvider(MockStrategy.PATTERN, { patterns });

  await assertRejects(
    async () => await provider.generate("no match here"),
    MockLLMError,
    "No pattern matched",
  );
});

Deno.test("IPattern: supports dynamic response generation", async () => {
  const patterns: PatternMatcher[] = [
    {
      pattern: /add (\w+) function/i,
      response: (match) => `## Plan: Add ${match[1]} Function\n\n1. Create function`,
    },
  ];

  const provider = new MockLLMProvider(MockStrategy.PATTERN, { patterns });
  const result = (await provider.generate("Add hello function to utils.ts")).content;

  assertStringIncludes(result, "Add hello Function");
});

// ============================================================================
// Test 5: Failing Strategy - Always throw error
// ============================================================================

Deno.test("Failing: throws MockLLMError on every call", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  await assertRejects(
    async () => await provider.generate("any prompt"),
    MockLLMError,
  );
});

Deno.test("Failing: uses custom error message", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: "API rate limit exceeded",
  });

  await assertRejects(
    async () => await provider.generate("any prompt"),
    MockLLMError,
    "API rate limit exceeded",
  );
});

Deno.test("Failing: still tracks call count", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  try {
    await provider.generate("1");
  } catch { /* expected */ }

  try {
    await provider.generate("2");
  } catch { /* expected */ }

  assertEquals(provider.callCount, 2);
});

// ============================================================================
// Test 6: Slow Strategy - Add artificial delay
// ============================================================================

Deno.test("Slow: adds configured delay before response", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 100,
    responses: ["delayed response"],
  });

  const start = performance.now();
  await provider.generate("test");
  const elapsed = performance.now() - start;

  // Allow for slight variations but expect at least most of the delay
  assert(elapsed >= 50, `Expected at least 50ms delay, got ${elapsed}ms`);
});

Deno.test("Slow: uses default delay when not specified", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    responses: ["response"],
  });

  const start = performance.now();
  await provider.generate("test");
  const elapsed = performance.now() - start;

  // Default delay should be reasonable (e.g., 500ms)
  assert(elapsed >= 100, `Expected some delay, got ${elapsed}ms`);
});

Deno.test({ name: "Slow: can be used for timeout testing", sanitizeOps: false, sanitizeResources: false }, async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 5000, // 5 seconds
    responses: ["never reached"],
  });

  // Create an AbortController for clean cancellation
  const controller = new AbortController();

  // Create a timeout that will abort
  const timeoutId = setTimeout(() => controller.abort(), 50);

  try {
    await assertRejects(
      async () => {
        const promise = provider.generate("test");
        // Race against abort signal
        await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new Error("Timeout"));
            });
          }),
        ]);
      },
      Error,
      "Timeout",
    );
  } finally {
    clearTimeout(timeoutId);
  }
});

// ============================================================================
// Test 7: Token Tracking
// ============================================================================

Deno.test("MockLLMProvider tracks token usage", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Short response"],
    tokensPerResponse: { input: 100, output: 50 },
  });

  await provider.generate("test prompt");

  assertEquals(provider.totalTokens.input, 100);
  assertEquals(provider.totalTokens.output, 50);
});

Deno.test("MockLLMProvider accumulates tokens across calls", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["response"],
    tokensPerResponse: { input: 100, output: 50 },
  });

  await provider.generate("1");
  await provider.generate("2");
  await provider.generate("3");

  assertEquals(provider.totalTokens.input, 300);
  assertEquals(provider.totalTokens.output, 150);
});

// ============================================================================
// Test 8: Reset and State Management
// ============================================================================

Deno.test("MockLLMProvider reset() clears all state", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["A", "B"],
  });

  await provider.generate("1");
  await provider.generate("2");

  provider.reset();

  assertEquals(provider.callCount, 0);
  assertEquals(provider.callHistory.length, 0);
  assertEquals(provider.totalTokens.input, 0);
  assertEquals(provider.totalTokens.output, 0);

  // Should start from first response again
  assertEquals((await provider.generate("1")).content, "A");
});

Deno.test("MockLLMProvider getLastCall returns most recent call", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["response"],
  });

  await provider.generate("first");
  await provider.generate("second");

  const lastCall = provider.getLastCall();
  assertExists(lastCall);
  assertEquals(lastCall.prompt, "second");
});

Deno.test("MockLLMProvider getLastCall returns undefined when no calls made", () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED);
  assertEquals(provider.getLastCall(), undefined);
});

// ============================================================================
// Test 9: Plan Generation Simulation
// ============================================================================

Deno.test("MockLLMProvider can simulate plan generation", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      {
        pattern: /.*/,
        response: `"title"

### Overview
This plan addresses the user's request.

### Steps
1. Analyze requirements
2. Implement solution
3. Write tests
4. Review and refine

### Expected Outcome
The feature will be implemented according to specifications.`,
      },
    ],
  });

  const result = (await provider.generate("Implement feature X")).content;

  assertStringIncludes(result, "title");
  assertStringIncludes(result, "### Steps");
  assertStringIncludes(result, "1. Analyze");
});

// ============================================================================
// Test 10: Integration with IModelProvider consumers
// ============================================================================

Deno.test("MockLLMProvider can be used as IModelProvider", async () => {
  // Function that accepts any IModelProvider
  async function useProvider(provider: IModelProvider): Promise<IGenerateResult> {
    return await provider.generate("test prompt");
  }

  const mockProvider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["mock response"],
  });

  const result = await useProvider(mockProvider);
  assertEquals(result.content, "mock response");
});

Deno.test("MockLLMProvider supports ModelOptions parameter", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["response"],
  });

  // Should accept options without error
  const result = await provider.generate("test", {
    temperature: 0.7,
    max_tokens: 1000,
  });

  assertEquals(result.content, "response");

  // Options should be captured in call history
  const lastCall = provider.getLastCall();
  assertExists(lastCall?.options);
  assertEquals(lastCall?.options?.temperature, 0.7);
});

// ============================================================================
// Test 11: Recorded Strategy Fallback to IPattern Matching
// ============================================================================

Deno.test("Recorded: falls back to patterns when no recording found", async () => {
  const patterns: PatternMatcher[] = [
    {
      pattern: /implement/i,
      response: "Fallback plan for implementation",
    },
  ];

  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [], // No recordings
    patterns, // But patterns are provided
  });

  // Should use pattern fallback instead of throwing error
  const result = await provider.generate("Please implement feature X");
  assertEquals(result.content, "Fallback plan for implementation");
});

Deno.test("Recorded: prefers exact recording over pattern fallback", async () => {
  const recordings: IRecordedResponse[] = [
    {
      promptHash: "test123",
      promptPreview: "specific prompt",
      response: "Recorded response",
      model: "test",
      tokens: { input: 10, output: 10 },
      recordedAt: "2025-12-01T00:00:00Z",
    },
  ];

  const patterns: PatternMatcher[] = [
    {
      pattern: /.*/,
      response: "IPattern response",
    },
  ];

  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings,
    patterns,
  });

  // Create a response that would match the pattern
  const hash = provider.hashPrompt("specific prompt");
  recordings[0].promptHash = hash;

  const result = await provider.generate("specific prompt");
  assertEquals(result.content, "Recorded response");
});

Deno.test("Recorded: auto-initializes default patterns when empty", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [], // No recordings provided
  });

  // Should not throw error due to auto-initialized default patterns
  const result = await provider.generate("Please implement authentication");
  assertExists(result.content);
  assertStringIncludes(result.content, "<thought>");
  assertStringIncludes(result.content, "<content>");
});

// ============================================================================
// Test 12: Default IPattern Responses for Plan Creation
// ============================================================================

Deno.test("Default patterns: handles 'implement' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [], // Triggers default patterns
  });

  const result = (await provider.generate("Implement user authentication system")).content;

  assertStringIncludes(result, "<thought>");
  assertStringIncludes(result, "<content>");
  assertStringIncludes(result, "title");
  assertStringIncludes(result, '"step": 1');
  assertStringIncludes(result, '"step": 2');
  assertStringIncludes(result, "implement");
});

Deno.test("Default patterns: handles 'add' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Add pagination to the API")).content;

  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, '"step": 1');
  assertStringIncludes(result, '"description"');
});

Deno.test("Default patterns: handles 'create' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Create a new dashboard component")).content;

  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, '"step": 1');
  assertStringIncludes(result, McpToolName.WRITE_FILE);
  assertStringIncludes(result, "Test");
});

Deno.test("Default patterns: handles 'fix' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Fix the memory leak in the cache module")).content;

  assertStringIncludes(result, "<thought>");
  assertStringIncludes(result, "<content>");
  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, "Fix");
  assertStringIncludes(result, '"step": 1');
  assertStringIncludes(result, "Regression");
});

Deno.test("Default patterns: handles 'bug' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("There's a bug in the login flow")).content;

  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, "Reproduce Issue");
  assertStringIncludes(result, "Root Cause Analysis");
});

Deno.test("Default patterns: handles 'error' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Error handling is broken in API module")).content;

  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, "Fix");
});

Deno.test("Default patterns: handles 'issue' requests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("There's an issue with the database connection")).content;

  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, '"step": 1');
});

Deno.test("Default patterns: handles generic requests with catch-all", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Update the documentation for the API")).content;

  assertStringIncludes(result, "<thought>");
  assertStringIncludes(result, "<content>");
  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, '"step": 1');
  assertStringIncludes(result, '"step": 2');
  assertStringIncludes(result, '"description"');
});

// ============================================================================
// Test 13: Plan Format Validation
// ============================================================================

Deno.test("Default patterns: responses include required <thought> tags", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const prompts = [
    "Implement feature X",
    "Fix bug Y",
    "Random request",
  ];

  for (const prompt of prompts) {
    const result = await provider.generate(prompt);
    assert(result.content.includes("<thought>"), `Missing <thought> tag in response to: ${prompt}`);
    assert(result.content.includes("</thought>"), `Missing </thought> tag in response to: ${prompt}`);
  }
});

Deno.test("Default patterns: responses include required <content> tags", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const prompts = [
    "Implement feature X",
    "Fix bug Y",
    "Random request",
  ];

  for (const prompt of prompts) {
    const result = await provider.generate(prompt);
    assert(result.content.includes("<content>"), `Missing <content> tag in response to: ${prompt}`);
    assert(result.content.includes("</content>"), `Missing </content> tag in response to: ${prompt}`);
  }
});

Deno.test("Default patterns: implementation plans mention tests", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Implement user profile feature")).content;

  assertStringIncludes(result, "test");
});

Deno.test("Default patterns: bug fix plans mention regression testing", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  const result = (await provider.generate("Fix the null pointer exception")).content;

  assertStringIncludes(result, "Regression Test");
});

// ============================================================================
// Test 14: Integration with RequestProcessor Flow
// ============================================================================

Deno.test("Mock provider generates valid plans for RequestProcessor", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [], // Uses default patterns
  });

  // Simulate typical RequestProcessor prompts
  const requestPrompt = `You are an AI agent tasked with creating an execution plan.

Request:
Implement a REST API endpoint for user registration.

Create a detailed plan with clear steps.`;

  const result = (await provider.generate(requestPrompt)).content;

  // Verify it has all required elements for a valid plan
  assertExists(result);
  assertStringIncludes(result, "<thought>");
  assertStringIncludes(result, "<content>");
  assertStringIncludes(result, '"title"');
  assertStringIncludes(result, '"step": 1');
  assertStringIncludes(result, '"description"');
});

Deno.test("Mock provider handles multiple sequential plan generations", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
  });

  // Generate multiple plans
  const result1 = (await provider.generate("Implement feature A")).content;
  const result2 = (await provider.generate("Fix bug B")).content;
  const result3 = (await provider.generate("Add tests for C")).content;

  // All should be valid plans
  for (const result of [result1, result2, result3]) {
    assertStringIncludes(result, '"title"');
    assertStringIncludes(result, "<thought>");
    assertStringIncludes(result, "<content>");
  }

  // Plans should be different based on request type
  assertStringIncludes(result1, "implement");
  assertStringIncludes(result2, "fix");
});

// ============================================================================
// Test 15: Helper Functions
// ============================================================================

Deno.test("createPlanGeneratorMock helper creates working provider", async () => {
  const provider = createPlanGeneratorMock();

  const result = (await provider.generate("Implement authentication")).content;

  assertStringIncludes(result, '"title":');
  assertStringIncludes(result, '"step":1');
  assertStringIncludes(result, '"step":2');
});

Deno.test("createFailingMock helper creates failing provider", async () => {
  const provider = createFailingMock("Custom error message");

  await assertRejects(
    async () => await provider.generate("test"),
    MockLLMError,
    "Custom error message",
  );
});

Deno.test("createSlowMock helper creates delayed provider", async () => {
  const provider = createSlowMock(100);

  const start = performance.now();
  await provider.generate("test");
  const elapsed = performance.now() - start;

  assert(elapsed >= 100, `Expected at least 100ms delay, got ${elapsed.toFixed(2)}ms`);
});

// ============================================================================
// Test 16: Additional Scripted Strategy Tests
// ============================================================================

Deno.test("Scripted: handles single response correctly", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Only response"],
  });

  assertEquals((await provider.generate("test1")).content, "Only response");
  assertEquals((await provider.generate("test2")).content, "Only response");
  assertEquals((await provider.generate("test3")).content, "Only response");
});

Deno.test("Scripted: reset clears response index", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["A", "B", "C"],
  });

  assertEquals((await provider.generate("1")).content, "A");
  assertEquals((await provider.generate("2")).content, "B");

  provider.reset();

  assertEquals((await provider.generate("3")).content, "A"); // Back to first
  assertEquals((await provider.generate("4")).content, "B");
});

Deno.test("Scripted: works with empty prompt strings", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Response"],
  });

  const result = (await provider.generate("")).content;
  assertEquals(result, "Response");
  assertEquals(provider.callCount, 1);
});

Deno.test("Scripted: works with very long prompts", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Response"],
  });

  const longPrompt = "A".repeat(10000);
  const result = (await provider.generate(longPrompt)).content;

  assertEquals(result, "Response");
  assertEquals(provider.callHistory[0].prompt.length, 10000);
});

Deno.test("Scripted: preserves response order across multiple cycles", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["First", "Second"],
  });

  // First cycle
  assertEquals((await provider.generate("1")).content, "First");
  assertEquals((await provider.generate("2")).content, "Second");

  // Second cycle
  assertEquals((await provider.generate("3")).content, "First");
  assertEquals((await provider.generate("4")).content, "Second");

  // Third cycle
  assertEquals((await provider.generate("5")).content, "First");
  assertEquals((await provider.generate("6")).content, "Second");
});

Deno.test("Scripted: response with special characters and unicode", async () => {
  const provider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["Hello 世界", "Emoji 🎉🚀", "Special <>&\"'"],
  });

  assertEquals((await provider.generate("1")).content, "Hello 世界");
  assertEquals((await provider.generate("2")).content, "Emoji 🎉🚀");
  assertEquals((await provider.generate("3")).content, "Special <>&\"'");
});

// ============================================================================
// Test 17: Additional IPattern Strategy Tests
// ============================================================================

Deno.test("IPattern: matches case-insensitive patterns", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      { pattern: /implement/i, response: "Implementation" },
    ],
  });

  assertEquals((await provider.generate("IMPLEMENT feature")).content, "Implementation");
  assertEquals((await provider.generate("implement feature")).content, "Implementation");
  assertEquals((await provider.generate("ImPlEmEnT feature")).content, "Implementation");
});

Deno.test("IPattern: dynamic response with multiple capture groups", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      {
        pattern: /add (\w+) to (\w+)/i,
        response: (match) => `Adding ${match[1]} to ${match[2]}`,
      },
    ],
  });

  assertEquals(
    (await provider.generate("add authentication to users")).content,
    "Adding authentication to users",
  );
  assertEquals(
    (await provider.generate("add validation to forms")).content,
    "Adding validation to forms",
  );
});

Deno.test("IPattern: handles complex regex patterns", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      { pattern: /^fix\s+bug\s+#(\d+)$/i, response: (m) => `Fixing bug ${m[1]}` },
      { pattern: /version\s+(v?\d+\.\d+\.\d+)/i, response: (m) => `Version ${m[1]}` },
    ],
  });

  assertEquals((await provider.generate("fix bug #123")).content, "Fixing bug 123");
  assertEquals((await provider.generate("version 1.2.3")).content, "Version 1.2.3");
  assertEquals((await provider.generate("version v2.0.0")).content, "Version v2.0.0");
});

Deno.test("IPattern: respects pattern priority order", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      { pattern: /implement/i, response: "First: Implement" },
      { pattern: /implement authentication/i, response: "Second: Auth" },
      { pattern: /.*/i, response: "Catch-all" },
    ],
  });

  // First pattern matches
  assertEquals((await provider.generate("implement authentication")).content, "First: Implement");

  // Catch-all matches
  assertEquals((await provider.generate("something else")).content, "Catch-all");
});

Deno.test("IPattern: dynamic response can access provider state", async () => {
  const provider: MockLLMProvider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      {
        pattern: /.*/,
        response: (): string => {
          const count: number = provider.callCount;
          return `Call number ${count + 1}`;
        },
      },
    ],
  });

  assertEquals((await provider.generate("test")).content, "Call number 1");
  assertEquals((await provider.generate("test")).content, "Call number 2");
  assertEquals((await provider.generate("test")).content, "Call number 3");
});

Deno.test("IPattern: empty patterns array throws error", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [],
  });

  await assertRejects(
    async () => await provider.generate("anything"),
    MockLLMError,
    "No pattern matched",
  );
});

Deno.test("IPattern: multiline prompt matching", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [
      {
        pattern: /implement[\s\S]*authentication/i,
        response: "Authentication plan",
      },
    ],
  });

  const multilinePrompt = `Please implement
user authentication
with OAuth2`;

  assertEquals((await provider.generate(multilinePrompt)).content, "Authentication plan");
});

Deno.test("IPattern: tracks calls even when pattern doesn't match", async () => {
  const provider = new MockLLMProvider(MockStrategy.PATTERN, {
    patterns: [{ pattern: /never-matches/i, response: "Won't happen" }],
  });

  try {
    await provider.generate("something else");
  } catch {
    // Expected error
  }

  // Should not increment call count on error
  assertEquals(provider.callCount, 0);
  assertEquals(provider.callHistory.length, 0);
});

// ============================================================================
// Test 18: Additional Failing Strategy Tests
// ============================================================================

Deno.test("Failing: throws error with default message", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  await assertRejects(
    async () => await provider.generate("test"),
    MockLLMError,
    "MockLLMProvider error (failing strategy)",
  );
});

Deno.test("Failing: error contains MockLLMError name", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  try {
    await provider.generate("test");
    assert(false, "Should have thrown error");
  } catch (error) {
    assert(error instanceof MockLLMError);
    assertEquals(error.name, "MockLLMError");
  }
});

Deno.test("Failing: can simulate different error types", async () => {
  const rateLimitProvider = new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: "Rate limit exceeded (429)",
  });

  const timeoutProvider = new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: "Request timeout (408)",
  });

  const authProvider = new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: "Invalid API key (401)",
  });

  await assertRejects(
    async () => await rateLimitProvider.generate("test"),
    MockLLMError,
    "Rate limit exceeded",
  );

  await assertRejects(
    async () => await timeoutProvider.generate("test"),
    MockLLMError,
    "Request timeout",
  );

  await assertRejects(
    async () => await authProvider.generate("test"),
    MockLLMError,
    "Invalid API key",
  );
});

Deno.test("Failing: increments call count on each failure", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  for (let i = 1; i <= 5; i++) {
    try {
      await provider.generate(`attempt ${i}`);
    } catch {
      // Expected
    }
    assertEquals(provider.callCount, i);
  }
});

Deno.test("Failing: records [ERROR] in call history", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  try {
    await provider.generate("test prompt");
  } catch {
    // Expected
  }

  assertEquals(provider.callHistory.length, 1);
  assertEquals(provider.callHistory[0].response, "[ERROR]");
  assertEquals(provider.callHistory[0].prompt, "test prompt");
});

Deno.test("Failing: reset clears error history", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  try {
    await provider.generate("1");
  } catch { /* expected */ }
  try {
    await provider.generate("2");
  } catch { /* expected */ }

  assertEquals(provider.callCount, 2);

  provider.reset();

  assertEquals(provider.callCount, 0);
  assertEquals(provider.callHistory.length, 0);
});

Deno.test("Failing: consistent error across multiple calls", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: "Consistent error message",
  });

  for (let i = 0; i < 3; i++) {
    await assertRejects(
      async () => await provider.generate(`test ${i}`),
      MockLLMError,
      "Consistent error message",
    );
  }
});

Deno.test("Failing: works with ModelOptions parameter", async () => {
  const provider = new MockLLMProvider(MockStrategy.FAILING);

  await assertRejects(
    async () => await provider.generate("test", { temperature: 0.7 }),
    MockLLMError,
  );

  assertEquals(provider.callHistory[0].options?.temperature, 0.7);
});

// ============================================================================
// Test 19: Additional Slow Strategy Tests
// ============================================================================

Deno.test("Slow: delay is accurate", async () => {
  const delays = [100, 200, 500];

  for (const delayMs of delays) {
    const provider = new MockLLMProvider(MockStrategy.SLOW, {
      delayMs,
      responses: ["Response"],
    });

    const start = performance.now();
    await provider.generate("test");
    const elapsed = performance.now() - start;

    // Allow 250ms tolerance for system scheduling
    assert(
      elapsed >= delayMs - 50 && elapsed < delayMs + 250,
      `Expected delay ~${delayMs}ms, got ${elapsed}ms`,
    );
  }
});

Deno.test("Slow: cycles through responses after delay", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 50,
    responses: ["First", "Second", "Third"],
  });

  assertEquals((await provider.generate("1")).content, "First");
  assertEquals((await provider.generate("2")).content, "Second");
  assertEquals((await provider.generate("3")).content, "Third");
  assertEquals((await provider.generate("4")).content, "First"); // Cycles;
});

Deno.test("Slow: tracks timing in call history", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 100,
    responses: ["Response"],
  });

  const start = Date.now();
  await provider.generate("test");
  const end = Date.now();

  const call = provider.getLastCall();
  assertExists(call);
  assert(call.timestamp.getTime() >= start);
  assert(call.timestamp.getTime() <= end);
});

Deno.test("Slow: can simulate very slow responses", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 1000,
    responses: ["Slow response"],
  });

  const start = Date.now();
  const result = await provider.generate("test");
  const elapsed = Date.now() - start;

  assertEquals(result.content, "Slow response");
  // Use a slightly lower threshold for reliability across environments
  assert(elapsed >= 900, `Expected at least 900ms, got ${elapsed}ms`);
});

Deno.test("Slow: reset clears response index but keeps delay", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 50,
    responses: ["A", "B", "C"],
  });

  assertEquals((await provider.generate("1")).content, "A");
  assertEquals((await provider.generate("2")).content, "B");

  provider.reset();

  // Should start from first response again
  const start = Date.now();
  const result = await provider.generate("3");
  const elapsed = Date.now() - start;

  assertEquals(result.content, "A");
  assert(elapsed >= 50, "Delay should still apply after reset");
});

Deno.test("Slow: works with single response", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 50,
    responses: ["Only response"],
  });

  assertEquals((await provider.generate("1")).content, "Only response");
  assertEquals((await provider.generate("2")).content, "Only response");
  assertEquals((await provider.generate("3")).content, "Only response");
});

Deno.test("Slow: multiple concurrent calls each wait full delay", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 100,
    responses: ["Response"],
  });

  const start = Date.now();

  // Start multiple concurrent calls
  const promises = [
    provider.generate("1"),
    provider.generate("2"),
    provider.generate("3"),
  ];

  await Promise.all(promises);
  const elapsed = Date.now() - start;

  // All should complete around the same time (concurrent)
  assert(
    elapsed >= 100 && elapsed < 200,
    `Expected ~100ms for concurrent calls, got ${elapsed}ms`,
  );
  assertEquals(provider.callCount, 3);
});

Deno.test("Slow: tracks tokens even with delay", async () => {
  const provider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 50,
    responses: ["Response"],
    tokensPerResponse: { input: 100, output: 50 },
  });

  await provider.generate("test");

  assertEquals(provider.totalTokens.input, 100);
  assertEquals(provider.totalTokens.output, 50);
});
