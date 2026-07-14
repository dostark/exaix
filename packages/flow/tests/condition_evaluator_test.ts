/**
 * @module ConditionEvaluatorTest
 * @path packages/flow/tests/condition_evaluator_test.ts
 * @description Integration tests for the ConditionEvaluator, ExpressionError,
 * and parseCondition — verifying the full flow from condition string through
 * safe expression parsing to evaluation result.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ConditionEvaluationError,
  ConditionEvaluator,
  ExpressionError,
  type IConditionContext,
  parseCondition,
} from "@exaix/flow";
import type { IFlow, IFlowStep } from "@exaix/schemas/flow.ts";
import type { IStepResult } from "@exaix/flow";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";

const MOCK_FLOW: IFlow = {
  id: "f",
  name: "f",
  description: "Test flow fixture",
  version: "1",
  steps: [],
  output: { from: "s1", format: FlowOutputFormat.MARKDOWN },
  settings: { maxParallelism: 3, failFast: true, includeRequestCriteria: false },
};

const MOCK_STEP: IFlowStep = {
  id: "s1",
  name: "s1",
  type: FlowStepType.AGENT,
  identity: "test-agent",
  execution_mode: FlowStepExecutionMode.DECLARED,
  dependsOn: [],
  input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
  condition: undefined,
  retry: { maxAttempts: 1, backoffMs: 0 },
};

const MOCK_CONTEXT: IConditionContext = {
  results: {
    step1: { success: true, duration: 100, content: "output-1" },
    step2: { success: false, duration: 50, error: "Failed" },
  },
  request: { userPrompt: "test request", traceId: "trace-1", requestId: "req-1" },
  flow: { id: "flow-1", name: "Test Flow", version: "1.0" },
};

Deno.test("ConditionEvaluator: empty condition returns true", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("", MOCK_CONTEXT);
  assertEquals(result.shouldExecute, true);
});

Deno.test("ConditionEvaluator: evaluates simple boolean expressions", () => {
  const evaluator = new ConditionEvaluator();
  const t = evaluator.evaluate("true", MOCK_CONTEXT);
  assertEquals(t.shouldExecute, true);
  const f = evaluator.evaluate("false", MOCK_CONTEXT);
  assertEquals(f.shouldExecute, false);
});

Deno.test("ConditionEvaluator: evaluates comparison expressions", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("results.step1.success == true", MOCK_CONTEXT);
  assertEquals(result.shouldExecute, true);
});

Deno.test("ConditionEvaluator: evaluates logical AND", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate(
    "results.step1.success == true && results.step2.success == false",
    MOCK_CONTEXT,
  );
  assertEquals(result.shouldExecute, true);
});

Deno.test("ConditionEvaluator: evaluates logical OR", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate(
    "results.step1.success == false || results.step2.success == true",
    MOCK_CONTEXT,
  );
  assertEquals(result.shouldExecute, false);
});

Deno.test("ConditionEvaluator: returns error for invalid expression", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("results.step1.nonexistent >< 5", MOCK_CONTEXT);
  assertEquals(result.shouldExecute, false);
  assert(result.error !== undefined);
});

Deno.test("ConditionEvaluator: evaluateStepCondition handles missing condition", () => {
  const evaluator = new ConditionEvaluator();
  const step: IFlowStep = { ...MOCK_STEP, condition: undefined };
  const result = evaluator.evaluateStepCondition(
    step,
    new Map(),
    { userPrompt: "test" },
    MOCK_FLOW,
  );
  assertEquals(result.shouldExecute, true);
});

Deno.test("ConditionEvaluator: buildContext maps step results correctly", () => {
  const evaluator = new ConditionEvaluator();
  const stepResult: IStepResult = {
    stepId: "s1",
    success: true,
    duration: 10,
    startedAt: new Date(),
    completedAt: new Date(),
    result: { thought: "", content: '{"key":"val"}', raw: '{"key":"val"}' },
  };
  const stepResults = new Map([["s1", stepResult]]);
  const ctx = evaluator.buildContext(
    stepResults,
    { userPrompt: "test" },
    MOCK_FLOW,
  );
  assertEquals(ctx.results.s1.success, true);
  assertEquals(ctx.results.s1.content, '{"key":"val"}');
  assertEquals(typeof ctx.results.s1.data, "object");
});

Deno.test("parseCondition: parses valid expression into AST", () => {
  const node = parseCondition("results.step1.success == true");
  assertEquals(node.kind, "binary");
  assert(typeof node, "object");
});

Deno.test("parseCondition: throws ExpressionError for invalid syntax", () => {
  assertThrows(
    () => parseCondition("results.step1.success >< 5"),
    ExpressionError,
  );
});

Deno.test("ExpressionError: is an Error subclass", () => {
  const err = new ExpressionError("test error");
  assert(err instanceof Error);
  assertEquals(err.name, "ExpressionError");
  assertEquals(err.message, "test error");
});

Deno.test("ConditionEvaluationError: includes condition and stepId", () => {
  const err = new ConditionEvaluationError("eval failed", "someExpr", "step-1");
  assert(err instanceof Error);
  assertEquals(err.name, "ConditionEvaluationError");
  assertEquals(err.condition, "someExpr");
  assertEquals(err.stepId, "step-1");
  assertEquals(err.message, "eval failed");
});
