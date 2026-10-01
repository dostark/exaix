/**
 * @module GateEvaluatorStepRefTest
 * @path packages/flow/tests/gate_evaluator_step_ref_test.ts
 * @description Step-3 unit coverage for the gate-judge binding chain: GateEvaluator and
 *   JudgeEvaluator forward the identical bindingContext (stepRef + run snapshot) through
 *   IJudgeInvoker to the judge runner request; non-flow callers (no bindingContext on the
 *   gate config) pass none.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/gate_evaluator.ts, packages/flow/src/judge_evaluator.ts, packages/core/src/types/i_gate_evaluator.ts]
 */

import { assertEquals } from "@std/assert";
import { GateEvaluator, JudgeEvaluator } from "@exaix/flow";
import type { EvaluationCriterion, EvaluationResult } from "@exaix/core/evaluation";
import type { IBindingGateContext } from "@exaix/schemas";
import type { IAgentContext } from "@exaix/flow/judge_evaluator.ts";
import { FlowGateOnFail } from "@exaix/core";

const CRITERIA: EvaluationCriterion[] = [{ name: "correctness" } as EvaluationCriterion];

function makeResult(): EvaluationResult {
  return {
    overallScore: 1,
    criteriaScores: { correctness: { name: "correctness", score: 1, reasoning: "", issues: [], passed: true } },
    pass: true,
    feedback: "ok",
    suggestions: [],
    metadata: { evaluatedAt: new Date().toISOString() },
  };
}

function makeContext(): IBindingGateContext {
  return {
    stepRef: {
      flowId: "research",
      stepId: "gate-review",
      agentRole: "reviewer",
      kind: "gate",
      nativeTools: false,
    },
    snapshot: {
      traceId: "trace-1",
      flowId: "research",
      layers: {
        entries: [],
        catalog: { models: {}, services: {}, preferences: {} },
        overlaySha256: [],
        operatorLayersPresent: false,
      },
      bindings: new Map(),
      issues: [],
      envIgnored: false,
    },
  };
}

Deno.test("GateEvaluator forwards the identical bindingContext object to IJudgeInvoker", async () => {
  let received: IBindingGateContext | undefined;
  const invoker = {
    evaluate: (
      _role: string,
      _content: string,
      _criteria: EvaluationCriterion[],
      _context?: string,
      bindingContext?: IBindingGateContext,
    ): Promise<EvaluationResult> => {
      received = bindingContext;
      return Promise.resolve(makeResult());
    },
  };
  const gate = new GateEvaluator(invoker);
  const gateContext = makeContext();
  const result = await gate.evaluate({
    agentRole: "reviewer",
    criteria: ["correctness"],
    threshold: 0.8,
    onFail: FlowGateOnFail.HALT,
    maxRetries: 3,
    includeRequestCriteria: false,
    bindingContext: gateContext,
  }, "content to grade");
  assertEquals(result.passed, true);
  assertEquals(received, gateContext);
});

Deno.test("GateEvaluator passes no bindingContext when the gate config carries none (non-flow caller)", async () => {
  let received: IBindingGateContext | undefined = makeContext();
  const invoker = {
    evaluate: (
      _role: string,
      _content: string,
      _criteria: EvaluationCriterion[],
      _context?: string,
      bindingContext?: IBindingGateContext,
    ): Promise<EvaluationResult> => {
      received = bindingContext;
      return Promise.resolve(makeResult());
    },
  };
  const gate = new GateEvaluator(invoker);
  await gate.evaluate({
    agentRole: "reviewer",
    criteria: ["correctness"],
    threshold: 0.8,
    onFail: FlowGateOnFail.HALT,
    maxRetries: 3,
    includeRequestCriteria: false,
  }, "content to grade");
  assertEquals(received, undefined);
});

Deno.test("JudgeEvaluator forwards the identical bindingContext into the judge runner request", async () => {
  let received: IBindingGateContext | undefined;
  const runner = {
    run: (
      _role: string,
      request: { userPrompt: string; context?: IAgentContext; bindingContext?: IBindingGateContext },
    ) => {
      received = request.bindingContext;
      return Promise.resolve({ content: JSON.stringify(makeResult()) });
    },
  };
  const judge = new JudgeEvaluator(runner);
  const gateContext = makeContext();
  const result = await judge.evaluate("reviewer", "content", CRITERIA, "ctx", gateContext);
  assertEquals(result.pass, true);
  assertEquals(received, gateContext);
});

Deno.test("JudgeEvaluator passes no bindingContext to the runner when none is supplied", async () => {
  let received: IBindingGateContext | undefined = makeContext();
  const runner = {
    run: (
      _role: string,
      request: { userPrompt: string; context?: IAgentContext; bindingContext?: IBindingGateContext },
    ) => {
      received = request.bindingContext;
      return Promise.resolve({ content: JSON.stringify(makeResult()) });
    },
  };
  const judge = new JudgeEvaluator(runner);
  await judge.evaluate("reviewer", "content", CRITERIA, "ctx");
  assertEquals(received, undefined);
});
