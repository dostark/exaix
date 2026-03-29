/**
 * @module FlowConditionEvaluatorTest
 * @path tests/flows/condition_evaluator_test.ts
 * @description Verifies the boolean logic engine in Agentic Flows, ensuring accurate
 * cross-step variable resolution and expression evaluation for conditional branching.
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepType, StepExecutionMode } from "../../src/shared/enums.ts";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";
import { ConditionEvaluator, IConditionContext } from "../../src/flows/condition_evaluator.ts";
import { IFlow, IFlowStep } from "../../src/shared/schemas/flow.ts";
import { IStepResult } from "../../src/flows/flow_runner.ts";
import { JSONValue } from "../../src/shared/types/json.ts";
import { DEFAULT_FLOW_VERSION } from "../../src/shared/constants.ts";

const createContext = (
  results: Record<string, { success: boolean; content?: string; data?: JSONValue }> = {},
): IConditionContext => ({
  results: Object.fromEntries(
    Object.entries(results).map(([id, r]) => [
      id,
      {
        success: r.success,
        content: r.content,
        data: r.data,
        duration: 100,
      },
    ]),
  ),
  request: {
    userPrompt: "Test prompt",
    traceId: "test-trace",
    requestId: "test-request",
  },
  flow: {
    id: "test-flow",
    name: "Test Flow",
    version: DEFAULT_FLOW_VERSION,
  },
});

const createMockStep = (overrides: Partial<IFlowStep> = {}): IFlowStep => ({
  id: "test-step",
  name: "Test Step",
  type: FlowStepType.AGENT,
  identity: "test-agent",
  execution_mode: StepExecutionMode.DECLARED,
  dependsOn: [],
  input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
  retry: { maxAttempts: 1, backoffMs: 1000 },
  ...overrides,
});

const createMockStepResult = (overrides: Partial<IStepResult> = {}): IStepResult => ({
  stepId: "test-step",
  success: true,
  duration: 100,
  startedAt: new Date(),
  completedAt: new Date(),
  result: { content: "output", thought: "", raw: "output" },
  ...overrides,
});

const mockFlow: IFlow = {
  id: "test-flow",
  name: "Test Flow",
  description: "Test flow for conditions",
  version: DEFAULT_FLOW_VERSION,
  steps: [],
  output: { from: "final", format: FlowOutputFormat.MARKDOWN },
  settings: { maxParallelism: 3, failFast: true, includeRequestCriteria: false },
};

const mockRequest = {
  userPrompt: "Test prompt",
  traceId: "trace-123",
  requestId: "request-456",
};

// Basic evaluation tests
Deno.test("ConditionEvaluator: returns true for empty condition", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("", createContext());
  assertEquals(result.shouldExecute, true);
  assertEquals(result.error, undefined);
});

Deno.test("ConditionEvaluator: returns true for whitespace-only condition", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("   ", createContext());
  assertEquals(result.shouldExecute, true);
});

Deno.test("ConditionEvaluator: evaluates simple boolean expressions", () => {
  const evaluator = new ConditionEvaluator();
  assertEquals(evaluator.evaluate("true", createContext()).shouldExecute, true);
  assertEquals(evaluator.evaluate("false", createContext()).shouldExecute, false);
});

Deno.test("ConditionEvaluator: accesses results object", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({
    "step-1": { success: true },
    "step-2": { success: false },
  });

  assertEquals(
    evaluator.evaluate("results['step-1'].success", context).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate("results['step-2'].success", context).shouldExecute,
    false,
  );
});

Deno.test("ConditionEvaluator: accesses result content", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({
    "analyze": { success: true, content: MemoryStatus.APPROVED },
  });

  assertEquals(
    evaluator.evaluate("results['analyze'].content === 'approved'", context).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate("results['analyze'].content === 'rejected'", context).shouldExecute,
    false,
  );
});

Deno.test("ConditionEvaluator: accesses result data", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({
    "check": { success: true, data: { score: 85, passed: true } },
  });

  assertEquals(
    evaluator.evaluate("results['check'].data?.passed === true", context).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate("results['check'].data?.score > 80", context).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate("results['check'].data?.score > 90", context).shouldExecute,
    false,
  );
});

Deno.test("ConditionEvaluator: accesses request properties", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext();

  assertEquals(
    evaluator.evaluate("request.userPrompt.length > 0", context).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate("request.traceId === 'test-trace'", context).shouldExecute,
    true,
  );
});

Deno.test("ConditionEvaluator: accesses flow properties", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext();

  assertEquals(
    evaluator.evaluate("flow.id === 'test-flow'", context).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate("flow.version === '1.0.0'", context).shouldExecute,
    true,
  );
});

Deno.test("ConditionEvaluator: handles complex boolean expressions", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({
    "step-a": { success: true },
    "step-b": { success: true },
    "step-c": { success: false },
  });

  assertEquals(
    evaluator.evaluate(
      "results['step-a'].success && results['step-b'].success",
      context,
    ).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate(
      "results['step-a'].success && results['step-c'].success",
      context,
    ).shouldExecute,
    false,
  );
  assertEquals(
    evaluator.evaluate(
      "results['step-a'].success || results['step-c'].success",
      context,
    ).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate(
      "!results['step-c'].success",
      context,
    ).shouldExecute,
    true,
  );
});

Deno.test("ConditionEvaluator: handles ternary expressions", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({
    "check": { success: true, data: { score: 75 } },
  });

  assertEquals(
    evaluator.evaluate(
      "results['check'].data?.score >= 70 ? true : false",
      context,
    ).shouldExecute,
    true,
  );
});

Deno.test("ConditionEvaluator: handles array methods", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({
    "step1": { success: true },
    "step2": { success: true },
    "step3": { success: false },
  });

  assertEquals(
    evaluator.evaluate(
      "['step1', 'step2'].every(id => results[id]?.success)",
      context,
    ).shouldExecute,
    true,
  );
  assertEquals(
    evaluator.evaluate(
      "['step1', 'step2', 'step3'].every(id => results[id]?.success)",
      context,
    ).shouldExecute,
    false,
  );
  assertEquals(
    evaluator.evaluate(
      "['step1', 'step3'].some(id => results[id]?.success)",
      context,
    ).shouldExecute,
    true,
  );
});

// Error handling tests
Deno.test("ConditionEvaluator: handles undefined result gracefully", () => {
  const evaluator = new ConditionEvaluator();
  const context = createContext({});

  const result = evaluator.evaluate("results['nonexistent']?.success === true", context);
  assertEquals(result.shouldExecute, false);
  assertEquals(result.error, undefined);
});

Deno.test("ConditionEvaluator: catches syntax errors", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("invalid {{{ syntax", createContext());
  assertEquals(result.shouldExecute, false);
  assertExists(result.error);
});

Deno.test("ConditionEvaluator: catches runtime errors", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.evaluate("nonExistentVariable.property", createContext());
  assertEquals(result.shouldExecute, false);
  assertExists(result.error);
});

// evaluateStepCondition tests
Deno.test("ConditionEvaluator.evaluateStepCondition: returns true when no condition", () => {
  const evaluator = new ConditionEvaluator();
  const step = createMockStep({ condition: undefined });
  const stepResults = new Map<string, IStepResult>();

  const result = evaluator.evaluateStepCondition(
    step,
    stepResults,
    mockRequest,
    mockFlow,
  );
  assertEquals(result.shouldExecute, true);
  assertEquals(result.condition, "");
});

Deno.test("ConditionEvaluator.evaluateStepCondition: evaluates condition with step results", () => {
  const evaluator = new ConditionEvaluator();
  const step = createMockStep({
    id: "step-2",
    dependsOn: ["step-1"],
    condition: "results['step-1'].success === true",
    input: { source: FlowInputSource.STEP, stepId: "step-1", transform: "passthrough" },
  });

  const stepResults = new Map<string, IStepResult>();
  stepResults.set("step-1", createMockStepResult({ stepId: "step-1" }));

  const result = evaluator.evaluateStepCondition(
    step,
    stepResults,
    mockRequest,
    mockFlow,
  );
  assertEquals(result.shouldExecute, true);
});

Deno.test("ConditionEvaluator.evaluateStepCondition: returns false when condition evaluates to false", () => {
  const evaluator = new ConditionEvaluator();
  const step = createMockStep({
    id: "conditional-step",
    dependsOn: ["check"],
    condition: "results['check'].data?.passed === true",
    input: { source: FlowInputSource.STEP, stepId: "check", transform: "passthrough" },
  });

  const stepResults = new Map<string, IStepResult>();
  stepResults.set(
    "check",
    createMockStepResult({
      stepId: "check",
      result: { content: '{"passed": false}', thought: "", raw: '{"passed": false}' },
    }),
  );

  const result = evaluator.evaluateStepCondition(
    step,
    stepResults,
    mockRequest,
    mockFlow,
  );
  assertEquals(result.shouldExecute, false);
});

// validateCondition tests
Deno.test("ConditionEvaluator.validateCondition: validates correct expressions", () => {
  const evaluator = new ConditionEvaluator();
  assertEquals(evaluator.validateCondition("true").valid, true);
  assertEquals(evaluator.validateCondition("results['x'].success").valid, true);
  assertEquals(
    evaluator.validateCondition("results['a'].success && results['b'].success").valid,
    true,
  );
});

Deno.test("ConditionEvaluator.validateCondition: invalidates syntax errors", () => {
  const evaluator = new ConditionEvaluator();
  const result = evaluator.validateCondition("invalid {{{ syntax");
  assertEquals(result.valid, false);
  assertExists(result.error);
});

Deno.test("ConditionEvaluator.validateCondition: validates empty conditions", () => {
  const evaluator = new ConditionEvaluator();
  assertEquals(evaluator.validateCondition("").valid, true);
  assertEquals(evaluator.validateCondition("  ").valid, true);
});

// buildContext tests
Deno.test("ConditionEvaluator.buildContext: converts StepResult map to context", () => {
  const evaluator = new ConditionEvaluator();
  const stepResults = new Map<string, IStepResult>();
  stepResults.set(
    "step-1",
    createMockStepResult({
      stepId: "step-1",
      success: true,
      duration: 150,
      result: { content: "result 1", thought: "", raw: "result 1" },
    }),
  );
  stepResults.set(
    "step-2",
    createMockStepResult({
      stepId: "step-2",
      success: false,
      duration: 200,
      error: "Something failed",
    }),
  );

  const context = evaluator.buildContext(stepResults, mockRequest, mockFlow);

  assertEquals(context.results["step-1"].success, true);
  assertEquals(context.results["step-1"].content, "result 1");
  assertEquals(context.results["step-1"].duration, 150);

  assertEquals(context.results["step-2"].success, false);
  assertEquals(context.results["step-2"].error, "Something failed");

  assertEquals(context.request.userPrompt, "Test prompt");
  assertEquals(context.flow.id, "test-flow");
});

Deno.test("ConditionEvaluator.buildContext: handles empty step results", () => {
  const evaluator = new ConditionEvaluator();
  const stepResults = new Map<string, IStepResult>();

  const context = evaluator.buildContext(stepResults, mockRequest, mockFlow);

  assertEquals(Object.keys(context.results).length, 0);
  assertEquals(context.request.userPrompt, "Test prompt");
});
