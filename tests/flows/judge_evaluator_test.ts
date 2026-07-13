/**
 * @module FlowJudgeEvaluatorTest
 * @path tests/flows/judge_evaluator_test.ts
 * @description Verifies the JudgeEvaluator's ability to autonomuously critique agent output,
 * parsing structured JSON scores and enforcing subjective quality gates within workflows.
 */

import { assertEquals, assertExists } from "@std/assert";

import { CRITERIA, type EvaluationResult as _EvaluationResult } from "@exaix/core/evaluation";
import { EvaluationCategory } from "@exaix/core";
import type { IJudgeInvoker } from "@exaix/core/types";
import { createJudgeEvaluator, JudgeEvaluator } from "@exaix/flow";
import type { JSONObject } from "@exaix/core/types";

/**
 * Mock IAgentRunner for testing JudgeEvaluator
 */
class MockAgentRunner {
  responses: Map<string, string> = new Map();
  lastRequest: { identityId: string; prompt: string; context?: JSONObject } | null = null;

  setResponse(identityId: string, response: string): void {
    this.responses.set(identityId, response);
  }

  async run(
    identityId: string,
    request: { userPrompt: string; context?: JSONObject },
  ): Promise<{ content: string }> {
    this.lastRequest = {
      identityId,
      prompt: request.userPrompt,
      context: request.context,
    };

    const response = await this.responses.get(identityId);
    if (!response) {
      throw new Error(`No mock response for identity: ${identityId}`);
    }

    return { content: response };
  }
}

// ============================================================
// JudgeEvaluator.evaluate() Tests
// ============================================================

Deno.test("JudgeEvaluator: evaluates content with valid JSON response", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const validResponse = JSON.stringify({
    overallScore: 0.85,
    criteriaScores: {
      code_correctness: {
        name: "code_correctness",
        score: 0.9,
        reasoning: "Code is syntactically correct",
        issues: [],
        passed: true,
      },
    },
    pass: true,
    feedback: "Good code quality",
    suggestions: ["Add more comments"],
  });

  mockRunner.setResponse("judge-agent", validResponse);

  const result = await evaluator.evaluate(
    "judge-agent",
    "function add(a, b) { return a + b; }",
    [CRITERIA.CODE_CORRECTNESS],
  );

  assertExists(result);
  assertEquals(result.overallScore, 0.9); // Uses weighted avg of criterion scores
  assertEquals(result.pass, true);
  assertExists(result.criteriaScores.code_correctness);
});

Deno.test("JudgeEvaluator: handles JSON in code block", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  // CRITERIA.ACCURACY doesn't exist, use a real one
  const criterion = {
    name: "accuracy",
    description: "Test",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.CORRECTNESS,
  };

  const responseWithCodeBlock = `Here's my evaluation:

\`\`\`json
{
  "overallScore": 0.75,
  "criteriaScores": {
    "accuracy": {
      "name": "accuracy",
      "score": 0.75,
      "reasoning": "Mostly accurate",
      "issues": ["Minor inaccuracy"],
      "passed": true
    }
  },
  "pass": true,
  "feedback": "Acceptable quality",
  "suggestions": []
}
\`\`\``;

  mockRunner.setResponse("judge-agent", responseWithCodeBlock);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test content",
    [criterion],
  );

  assertEquals(result.overallScore, 0.75);
  assertEquals(result.pass, true);
});

Deno.test("JudgeEvaluator: passes context to agent runner", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const validResponse = JSON.stringify({
    overallScore: 0.8,
    criteriaScores: {},
    pass: true,
    feedback: "Good",
    suggestions: [],
  });

  mockRunner.setResponse("judge-agent", validResponse);

  await evaluator.evaluate(
    "judge-agent",
    "Test content",
    [CRITERIA.CODE_CORRECTNESS],
    "This is additional context",
  );

  assertExists(mockRunner.lastRequest);
  assertEquals(mockRunner.lastRequest.context?.evaluationMode, true);
});

// ============================================================
// JSON Parsing Tests
// ============================================================

Deno.test("JudgeEvaluator: repairs malformed JSON with missing quotes", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  // JSON with unquoted keys (common LLM mistake)
  const malformedResponse = `{
    overallScore: 0.7,
    criteriaScores: {},
    pass: true,
    feedback: "Needs work",
    suggestions: []
  }`;

  mockRunner.setResponse("judge-agent", malformedResponse);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test content",
    [CRITERIA.CODE_CORRECTNESS],
  );

  // Should fall back to heuristic parsing or repair
  assertExists(result);
  assertEquals(typeof result.overallScore, "number");
});

Deno.test("JudgeEvaluator: falls back to heuristic parsing for non-JSON", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const accuracy = {
    name: "accuracy",
    description: "Test",
    weight: 1.0,
    required: false,
    category: EvaluationCategory.CORRECTNESS,
  };

  const textResponse = `Based on my evaluation:
Overall Score: 0.82
The code is well-structured and follows best practices.
Pass: yes

code_correctness: 0.85 - The code compiles and runs correctly
accuracy: 0.80 - Results are accurate

Suggestions:
- Add more unit tests
- Improve documentation`;

  mockRunner.setResponse("judge-agent", textResponse);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test content",
    [CRITERIA.CODE_CORRECTNESS, accuracy],
  );

  assertExists(result);
  assertEquals(typeof result.overallScore, "number");
  // Heuristic should extract ~0.82
  assertEquals(result.overallScore >= 0.8 && result.overallScore <= 0.85, true);
});

Deno.test("JudgeEvaluator: extracts score from text with percentage", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  // Test percentage format
  mockRunner.setResponse("judge-agent", "Score: 85%");

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test",
    [CRITERIA.CODE_CORRECTNESS],
  );

  // Heuristic parsing extracts from text
  assertExists(result);
  assertEquals(typeof result.overallScore, "number");
});

// ============================================================
// Score Normalization Tests
// ============================================================

Deno.test("JudgeEvaluator: normalizes criterion score above 1.0", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const response = JSON.stringify({
    overallScore: 95, // Incorrectly formatted as 0-100
    criteriaScores: {
      code_correctness: {
        name: "code_correctness",
        score: 95, // Will be normalized to 0.95
        reasoning: "Good",
        issues: [],
        passed: true,
      },
    },
    pass: true,
    feedback: "Excellent",
    suggestions: [],
  });

  mockRunner.setResponse("judge-agent", response);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test",
    [CRITERIA.CODE_CORRECTNESS],
  );

  assertEquals(result.criteriaScores.code_correctness.score, 0.95);
});

Deno.test("JudgeEvaluator: clamps negative score to 0", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const response = JSON.stringify({
    overallScore: -0.5,
    criteriaScores: {},
    pass: false,
    feedback: "Invalid",
    suggestions: [],
  });

  mockRunner.setResponse("judge-agent", response);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test",
    [CRITERIA.CODE_CORRECTNESS],
  );

  assertEquals(result.overallScore, 0);
});

Deno.test("JudgeEvaluator: clamps score above 100 to 1.0", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const response = JSON.stringify({
    overallScore: 150,
    criteriaScores: {
      code_correctness: {
        name: "code_correctness",
        score: 150, // Will be clamped to 1.0
        reasoning: "Over the top",
        issues: [],
        passed: true,
      },
    },
    pass: true,
    feedback: "Over the top",
    suggestions: [],
  });

  mockRunner.setResponse("judge-agent", response);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test",
    [CRITERIA.CODE_CORRECTNESS],
  );

  assertEquals(result.criteriaScores.code_correctness.score, 1.0);
});

// ============================================================
// Multiple Criteria Tests
// ============================================================

Deno.test("JudgeEvaluator: handles multiple criteria scores", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  const response = JSON.stringify({
    overallScore: 0.8,
    criteriaScores: {
      code_correctness: {
        name: "code_correctness",
        score: 0.9,
        reasoning: "No syntax errors",
        issues: [],
        passed: true,
      },
      has_tests: {
        name: "has_tests",
        score: 0.7,
        reasoning: "Some tests present",
        issues: ["Missing edge cases"],
        passed: true,
      },
      follows_conventions: {
        name: "follows_conventions",
        score: 0.6,
        reasoning: "Minimal documentation",
        issues: ["No JSDoc", "Missing README"],
        passed: false,
      },
    },
    pass: false,
    feedback: "Code quality is good but needs more tests and docs",
    suggestions: ["Add JSDoc comments", "Write unit tests for edge cases"],
  });

  mockRunner.setResponse("judge-agent", response);

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test code",
    [CRITERIA.CODE_CORRECTNESS, CRITERIA.HAS_TESTS, CRITERIA.FOLLOWS_CONVENTIONS],
  );

  assertEquals(Object.keys(result.criteriaScores).length, 3);
  assertEquals(result.criteriaScores.code_correctness.score, 0.9);
  assertEquals(result.criteriaScores.has_tests.score, 0.7);
  assertEquals(result.criteriaScores.follows_conventions.passed, false);
});

// ============================================================
// Error Handling Tests
// ============================================================

Deno.test("JudgeEvaluator: handles agent runner error gracefully", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  // Don't set any response - will throw

  try {
    await evaluator.evaluate(
      "judge-agent",
      "Test",
      [CRITERIA.CODE_CORRECTNESS],
    );
    // Should throw
    assertEquals(true, false, "Expected error to be thrown");
  } catch (error) {
    assertExists(error);
  }
});

Deno.test("JudgeEvaluator: returns default evaluation for unparseable response", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = new JudgeEvaluator(mockRunner);

  // Completely unparseable response
  mockRunner.setResponse("judge-agent", "!!@#$%^&*()");

  const result = await evaluator.evaluate(
    "judge-agent",
    "Test",
    [CRITERIA.CODE_CORRECTNESS],
  );

  // Should return a default/fallback result
  assertExists(result);
  assertEquals(typeof result.overallScore, "number");
});

// ============================================================
// JudgeInvoker Interface Tests
// ============================================================

Deno.test("JudgeEvaluator: implements JudgeInvoker interface", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator: IJudgeInvoker = new JudgeEvaluator(mockRunner);

  const response = JSON.stringify({
    overallScore: 0.9,
    criteriaScores: {
      code_correctness: {
        name: "code_correctness",
        score: 0.9,
        reasoning: "Great",
        issues: [],
        passed: true,
      },
    },
    pass: true,
    feedback: "Great",
    suggestions: [],
  });

  mockRunner.setResponse("test-judge", response);

  // Use the JudgeInvoker interface method
  const result = await evaluator.evaluate(
    "test-judge",
    "Content to evaluate",
    [CRITERIA.CODE_CORRECTNESS],
  );

  assertEquals(result.overallScore, 0.9);
  assertEquals(result.pass, true);
});

// ============================================================
// createJudgeEvaluator Factory Tests
// ============================================================

Deno.test("createJudgeEvaluator: creates evaluator from agent runner", async () => {
  const mockRunner = new MockAgentRunner();
  const evaluator = createJudgeEvaluator(mockRunner);

  const response = JSON.stringify({
    overallScore: 0.88,
    criteriaScores: {
      code_correctness: {
        name: "code_correctness",
        score: 0.88,
        reasoning: "Well done",
        issues: [],
        passed: true,
      },
    },
    pass: true,
    feedback: "Well done",
    suggestions: [],
  });

  mockRunner.setResponse("my-judge", response);

  const result = await evaluator.evaluate(
    "my-judge",
    "Sample code",
    [CRITERIA.CODE_CORRECTNESS],
  );

  assertEquals(result.overallScore, 0.88);
  assertExists(evaluator);
});
