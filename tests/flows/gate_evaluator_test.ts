/**
 * @module FlowGateEvaluatorTest
 * @path tests/flows/gate_evaluator_test.ts
 * @description Verifies workflow gate logic, ensuring correct routing and
 * retry decisions based on agent performance against defined thresholds.
 */

import { assertEquals, assertExists } from "@std/assert";
import { EvaluationCategory, FlowGateAction, FlowGateOnFail } from "@exaix/core";
import { GateEvaluator, MockJudgeInvoker } from "@exaix/flow";
import type { IGateConfig } from "@exaix/core/types";
import type { EvaluationCriterion, EvaluationResult } from "@exaix/core/evaluation";
import type { IStepResult } from "@exaix/flow";

const DEFAULT_CONFIG: IGateConfig = {
  agentRole: "judge-agent",
  criteria: ["CODE_CORRECTNESS"],
  threshold: 0.8,
  onFail: FlowGateOnFail.HALT,
  maxRetries: 3,
  includeRequestCriteria: false,
};

function setupEvaluator(score: number, configOverrides: Partial<IGateConfig> = {}) {
  const mockJudge = new MockJudgeInvoker();
  mockJudge.setDefaultScore(score);
  const evaluator = new GateEvaluator(mockJudge);
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  return { mockJudge, evaluator, config };
}

Deno.test("GateEvaluator: passes gate when score above threshold", async () => {
  const { evaluator, config } = setupEvaluator(0.85);
  const result = await evaluator.evaluate(config, "Test code content");

  assertEquals(result.passed, true);
  assertEquals(result.score >= 0.8, true);
  assertEquals(result.action, FlowGateAction.PASSED);
  assertExists(result.evaluation);
});

Deno.test("GateEvaluator: fails gate when score below threshold", async () => {
  const { evaluator, config } = setupEvaluator(0.65);
  const result = await evaluator.evaluate(config, "Poor quality code");

  assertEquals(result.passed, false);
  assertEquals(result.score < 0.8, true);
});

Deno.test("GateEvaluator: returns retry action when configured", async () => {
  const { evaluator, config } = setupEvaluator(0.6, { onFail: FlowGateOnFail.RETRY });

  // First attempt - should return retry
  const result = await evaluator.evaluate(config, "Content", undefined, 0);

  assertEquals(result.passed, false);
  assertEquals(result.action, FlowGateAction.RETRY);
  assertEquals(result.attempts, 1);
});

Deno.test("GateEvaluator: halts after max retries exceeded", async () => {
  const { evaluator, config } = setupEvaluator(0.6, { onFail: FlowGateOnFail.RETRY });

  // Last attempt (attempt 2 = third try with 0-indexing)
  const result = await evaluator.evaluate(config, "Content", undefined, 2);

  assertEquals(result.passed, false);
  assertEquals(result.action, FlowGateAction.HALTED);
  assertEquals(result.attempts, 3);
});

Deno.test("GateEvaluator: continues with warning when configured", async () => {
  const { evaluator, config } = setupEvaluator(0.5, {
    onFail: FlowGateOnFail.CONTINUE_WITH_WARNING,
    maxRetries: 1,
  });

  const result = await evaluator.evaluate(config, "Content");

  assertEquals(result.passed, false);
  assertEquals(result.action, "continued-with-warning");
});

Deno.test("GateEvaluator: uses specific mock result", async () => {
  const { mockJudge, evaluator, config } = setupEvaluator(0.85, { maxRetries: 1 });

  const customResult: EvaluationResult = {
    overallScore: 0.95,
    pass: true,
    feedback: "Excellent!",
    criteriaScores: {
      "code_correctness": {
        name: "code_correctness",
        score: 0.95,
        reasoning: "Perfect",
        issues: [],
        passed: true,
      },
    },
    suggestions: [],
    metadata: {
      evaluatedAt: new Date().toISOString(),
      evaluatorAgent: "judge-agent",
    },
  };
  mockJudge.setMockResult("judge-agent", customResult);

  const result = await evaluator.evaluate(config, "Content");

  assertEquals(result.passed, true);
  assertEquals(result.score, 0.95);
  assertEquals(result.evaluation.feedback, "Excellent!");
});

Deno.test("GateEvaluator: handles edge case scores", async () => {
  // Score exactly matches threshold (0.8)
  const { evaluator, config } = setupEvaluator(0.8, { maxRetries: 1 });
  const result = await evaluator.evaluate(config, "Content");

  assertEquals(result.passed, true);
});

Deno.test("GateEvaluator: tracks evaluation duration", async () => {
  const { evaluator, config } = setupEvaluator(0.85);
  const result = await evaluator.evaluate(config, "Content");

  assertExists(result.evaluationDurationMs);
  assertEquals(result.evaluationDurationMs >= 0, true);
});

Deno.test("GateEvaluator.evaluateStepResult: evaluates step result content", async () => {
  const { evaluator, config } = setupEvaluator(0.85);

  const now = new Date();
  const stepResult: IStepResult = {
    stepId: "s1",
    success: true,
    result: { content: "hello", thought: "", raw: "" },
    duration: 1,
    startedAt: now,
    completedAt: now,
  };

  const result = await evaluator.evaluateStepResult(config, stepResult, "original request");
  assertEquals(result.action, FlowGateAction.PASSED);
});

Deno.test("GateEvaluator: fails if required criteria fail even when overallScore meets threshold", async () => {
  const judgeInvoker = {
    evaluate: (
      _agentRole: string,
      _content: string,
      _criteria: EvaluationCriterion[],
      _context?: string,
    ): Promise<EvaluationResult> => {
      return Promise.resolve({
        overallScore: 0.95,
        pass: true,
        feedback: "Overall looks good but required criterion failed",
        criteriaScores: {
          code_correctness: {
            name: "code_correctness",
            score: 0.5,
            reasoning: "Has correctness issues",
            issues: ["Fails to compile"],
            passed: false,
          },
        },
        suggestions: [],
        metadata: { evaluatedAt: new Date().toISOString() },
      });
    },
  };

  const evaluator = new GateEvaluator(judgeInvoker);
  const config: IGateConfig = {
    agentRole: "judge-agent",
    criteria: ["CODE_CORRECTNESS"],
    threshold: 0.8,
    onFail: FlowGateOnFail.HALT,
    maxRetries: 1,
    includeRequestCriteria: false,
  };

  const result = await evaluator.evaluate(config, "content");
  assertEquals(result.passed, false);
  assertEquals(result.action, FlowGateAction.HALTED);
});

Deno.test("GateEvaluator: supports criteria objects in config.criteria", async () => {
  const { evaluator } = setupEvaluator(0.85);

  const customCriterion: EvaluationCriterion = {
    name: "custom_criterion",
    description: "Custom criterion",
    weight: 1,
    required: false,
    category: EvaluationCategory.QUALITY,
  };

  const config: IGateConfig = {
    agentRole: "judge-agent",
    criteria: [customCriterion],
    threshold: 0.8,
    onFail: FlowGateOnFail.HALT,
    maxRetries: 1,
    includeRequestCriteria: false,
  };

  const result = await evaluator.evaluate(config, "content");
  assertEquals(result.passed, true);
  assertEquals(Object.keys(result.evaluation.criteriaScores).includes("custom_criterion"), true);
});

Deno.test("GateEvaluator: handles judge errors and returns halted by default", async () => {
  const judgeInvoker = {
    evaluate: (
      _agentRole: string,
      _content: string,
      _criteria: EvaluationCriterion[],
      _context?: string,
    ): Promise<EvaluationResult> => {
      throw new Error("judge failed");
    },
  };

  const evaluator = new GateEvaluator(judgeInvoker);
  const config: IGateConfig = {
    agentRole: "judge-agent",
    criteria: ["CODE_CORRECTNESS"],
    threshold: 0.8,
    onFail: FlowGateOnFail.HALT,
    maxRetries: 1,
    includeRequestCriteria: false,
  };

  const result = await evaluator.evaluate(config, "content");
  assertEquals(result.passed, false);
  assertEquals(result.action, FlowGateAction.HALTED);
  assertEquals(result.error, "judge failed");
  assertEquals(result.evaluation.feedback.includes("Evaluation failed"), true);
});

Deno.test("GateEvaluator.formatFeedbackForRetry: includes failed criteria details and suggestions", () => {
  const output = GateEvaluator.formatFeedbackForRetry({
    passed: false,
    score: 0.6,
    attempts: 1,
    action: FlowGateAction.RETRY,
    evaluationDurationMs: 10,
    evaluation: {
      overallScore: 0.6,
      pass: false,
      feedback: "needs improvement",
      criteriaScores: {
        clarity: {
          name: "clarity",
          score: 0.4,
          reasoning: "Unclear",
          issues: ["Too verbose"],
          passed: false,
        },
      },
      suggestions: ["Be more concise"],
      metadata: { evaluatedAt: new Date().toISOString() },
    },
  });

  assertEquals(output.includes("## Quality Gate Feedback"), true);
  assertEquals(output.includes("### Areas Needing Improvement"), true);
  assertEquals(output.includes("#### clarity"), true);
  assertEquals(output.includes("Suggestions"), true);
});
