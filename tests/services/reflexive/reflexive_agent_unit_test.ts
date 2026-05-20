// deno-lint-ignore-file no-explicit-any
/**
 * @module ReflexiveAgentUnitTest
 * @path tests/services/reflexive/reflexive_agent_unit_test.ts
 * @description Verifies the logic of the ReflexiveAgent service, specifically its self-critique decision
 * trees, metric accumulation, and dynamic configuration of specialized review agents.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { CritiqueIssueType, CritiqueQuality, CritiqueSeverity } from "@exaix/core";
import {
  createCodeReviewReflexiveAgent,
  type ICritique,
  ReflexiveAgent,
} from "../../../src/services/agent/reflexive_agent.ts";
import type {
  IAgentExecutionResult,
  IAgentRunner,
  IBlueprint,
  IParsedRequest,
} from "../../../src/services/agent/agent_runner.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IOutputValidator, IValidationMetrics, IValidationResult, OutputValidator } from "@exaix/tool-runtime";
import { createStubDb } from "../../helpers/test_helpers.ts";
import type { JSONValue } from "@exaix/core/types";

function createMockRunner(
  runFn: (blueprint: IBlueprint, request: IParsedRequest) => Promise<IAgentExecutionResult>,
): IAgentRunner {
  return { run: runFn };
}

function createMockValidator(overrides: Partial<IOutputValidator> = {}): IOutputValidator {
  const defaultResult = { success: false, repairAttempted: false, repairSucceeded: false, raw: "" };

  return {
    validate: <T>(
      _content: string,
      _schema: any,
    ): IValidationResult<T> => defaultResult as IValidationResult<T>,
    parseXMLTags: (raw: string) => ({ thought: "", content: raw, raw }),
    validateWithSchema: (_content, _schemaName) => defaultResult as IValidationResult<unknown>,
    parseAndValidate: (_raw, _schema) => defaultResult as IValidationResult<unknown>,
    parseAndValidateWithSchema: (_raw, _schemaName) => defaultResult as IValidationResult<unknown>,
    getMetrics: (): IValidationMetrics => ({
      totalAttempts: 0,
      successfulValidations: 0,
      repairAttempts: 0,
      successfulRepairs: 0,
      failuresByErrorType: {},
    }),
    resetMetrics: () => {},
    ...overrides,
  } as OutputValidator;
}

const stubProvider: IModelProvider = {
  id: "stub",
  generate: (_prompt: string): Promise<IGenerateResult> =>
    Promise.resolve({
      content: "ok",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "stub-model",
      provider: "stub",
      cost_usd: 0,
    }),
};

Deno.test("ReflexiveAgent.shouldAccept: rejects critical issues regardless", () => {
  const agent = new ReflexiveAgent(stubProvider, { confidenceThreshold: 100, maxIterations: 1 });

  const critique: ICritique = {
    quality: CritiqueQuality.EXCELLENT,
    confidence: 100,
    passed: true,
    issues: [{ type: CritiqueIssueType.OTHER, severity: CritiqueSeverity.CRITICAL, description: "x" }],
    reasoning: "r",
  };

  const ok = agent.shouldAccept(critique);
  assertEquals(ok, false);
});

Deno.test("ReflexiveAgent.updateMetrics/resetMetrics track distributions", () => {
  const agent = new ReflexiveAgent(stubProvider, { maxIterations: 1 });

  agent.resetMetrics();
  const critique: ICritique = {
    quality: CritiqueQuality.GOOD,
    confidence: 10,
    passed: false,
    issues: [{ type: CritiqueIssueType.CLARITY, severity: CritiqueSeverity.MINOR, description: "x" }],
    reasoning: "r",
  };

  agent.updateMetrics(critique);
  const metrics = agent.getMetrics();

  assertEquals(metrics.qualityDistribution[CritiqueQuality.GOOD], 1);
  assertEquals(metrics.issueTypeDistribution[CritiqueIssueType.CLARITY], 1);
});

Deno.test("createCodeReviewReflexiveAgent: applies stricter defaults", () => {
  const agent = createCodeReviewReflexiveAgent(stubProvider);
  const cfg = agent.config;

  assertEquals(cfg.maxIterations, 2);
  assertEquals(cfg.minQuality, CritiqueQuality.GOOD);
  assertEquals(cfg.confidenceThreshold, 80);
});

Deno.test("ReflexiveAgent.logActivity: writes to db when present", () => {
  const calls: Array<unknown[]> = [];
  const db = createStubDb({
    logActivity: (
      actor: string,
      actionType: string,
      target: string | null,
      payload: Record<string, JSONValue>,
      traceId?: string,
      identityId?: string | null,
    ) => {
      calls.push([actor, actionType, target, payload, traceId, identityId]);
    },
  });

  const agent = new ReflexiveAgent(stubProvider, {
    db,
    maxIterations: 1,
  });
  agent.logActivity("a", "t", null, { k: 1 }, "trace");

  assertEquals(calls.length, 1);
});

Deno.test("ReflexiveAgent.run: emits reflexive observability events", async () => {
  const calls: Array<unknown[]> = [];
  const db = createStubDb({
    logActivity: (
      actor: string,
      actionType: string,
      target: string | null,
      payload: Record<string, JSONValue>,
      traceId?: string,
      identityId?: string | null,
    ) => {
      calls.push([actor, actionType, target, payload, traceId, identityId]);
    },
  });

  const agent = new ReflexiveAgent(stubProvider, {
    db,
    maxIterations: 3,
    confidenceThreshold: 70,
    scoreEveryNIterations: 1,
  });

  agent.agentBreaker.execute = <T>(fn: () => Promise<T>): Promise<T> => fn();
  agent.critiqueBreaker.execute = <T>(fn: () => Promise<T>): Promise<T> => fn();

  let runCount = 0;
  agent.agentRunner = createMockRunner(() => {
    runCount++;
    return Promise.resolve({ content: `response-${runCount}`, thought: "", raw: "" });
  });

  agent.critiqueRunner = createMockRunner(() => Promise.resolve({ content: "ignored", thought: "", raw: "" }));
  agent.outputValidator = createMockValidator({
    validate: <T>(_content: string, _schema: any): IValidationResult<T> => ({
      success: true,
      value: {
        quality: CritiqueQuality.GOOD,
        confidence: 80,
        passed: true,
        issues: [],
        reasoning: "ok",
      } as T,
      repairAttempted: false,
      repairSucceeded: false,
      raw: "",
    }),
  });

  const result = await agent.run(
    { systemPrompt: "", identityId: "agent" } satisfies IBlueprint,
    { userPrompt: "u", context: {}, traceId: "trace-1" } satisfies IParsedRequest,
  );

  assertEquals(result.earlyExit, true);
  assertEquals(result.totalIterations, 1);

  const budgetEvent = calls.find((call) => call[1] === "agent.iteration_budget_computed");
  assertExists(budgetEvent);
  assertEquals((budgetEvent[3] as { effectiveMaxIterations: number }).effectiveMaxIterations, 3);

  const scoredEvent = calls.find((call) => call[1] === "agent.iteration_scored");
  assertExists(scoredEvent);
  assertEquals((scoredEvent[3] as { iteration: number }).iteration, 1);

  const convergedEvent = calls.find((call) => call[1] === "agent.converged");
  assertExists(convergedEvent);
  assertEquals((convergedEvent[3] as { reason: string }).reason, "quality_threshold_met");
});

Deno.test("ReflexiveAgent.shouldAccept: accepts when confidence meets threshold", () => {
  const agent = new ReflexiveAgent(stubProvider, { confidenceThreshold: 60, maxIterations: 1 });

  const critique: ICritique = {
    quality: CritiqueQuality.POOR,
    confidence: 60,
    passed: false,
    issues: [],
    reasoning: "r",
  };

  const ok = agent.shouldAccept(critique);
  assertEquals(ok, true);
});

Deno.test("ReflexiveAgent.shouldAccept: accepts when quality meets minQuality", () => {
  const agent = new ReflexiveAgent(stubProvider, { minQuality: CritiqueQuality.ACCEPTABLE, maxIterations: 1 });

  const critique: ICritique = {
    quality: CritiqueQuality.GOOD,
    confidence: 0,
    passed: false,
    issues: [],
    reasoning: "r",
  };

  const ok = agent.shouldAccept(critique);
  assertEquals(ok, true);
});

Deno.test("ReflexiveAgent.critique: defaults to acceptable when critique response cannot be parsed", async () => {
  const agent = new ReflexiveAgent(stubProvider, { maxIterations: 1 });

  agent.critiqueRunner = createMockRunner(
    () => Promise.resolve({ content: "not-json", thought: "", raw: "" }),
  );

  const critique = await agent.critique(
    { userPrompt: "u", context: {}, traceId: "t" } satisfies IParsedRequest,
    { content: "resp", thought: "", raw: "" } satisfies IAgentExecutionResult,
  );

  assertExists(critique);
  assertEquals(critique.quality, CritiqueQuality.ACCEPTABLE);
  assertEquals(critique.passed, true);
  assertStringIncludes(critique.reasoning, "Unable to parse critique");
});

Deno.test("ReflexiveAgent.run: early-exits on first passing critique", async () => {
  const agent = new ReflexiveAgent(stubProvider, { maxIterations: 3 });

  // Make circuit breakers no-ops for deterministic unit testing.
  agent.agentBreaker.execute = <T>(fn: () => Promise<T>): Promise<T> => fn();
  agent.critiqueBreaker.execute = <T>(fn: () => Promise<T>): Promise<T> => fn();

  let agentRuns = 0;
  agent.agentRunner = createMockRunner(() => {
    agentRuns++;
    return Promise.resolve({ content: `resp-${agentRuns}`, thought: "", raw: "" });
  });

  agent.critiqueRunner = createMockRunner(
    () => Promise.resolve({ content: "ignored", thought: "", raw: "" }),
  );

  agent.outputValidator = createMockValidator({
    validate: <T>(_content: string, _schema: any): IValidationResult<T> => ({
      success: true,
      value: {
        quality: CritiqueQuality.ACCEPTABLE,
        confidence: 100,
        passed: true,
        issues: [],
        reasoning: "ok",
      } as T,
      repairAttempted: false,
      repairSucceeded: false,
      raw: "",
    }),
  });

  const result = await agent.run(
    { systemPrompt: "", identityId: "agent" } satisfies IBlueprint,
    { userPrompt: "u", context: {}, traceId: "t" } satisfies IParsedRequest,
  );

  assertEquals(result.totalIterations, 1);
  assertEquals(result.earlyExit, true);
  assertEquals(result.final.content, "resp-1");
  assertEquals(agentRuns, 1);
});

Deno.test("ReflexiveAgent.run: refines when critique fails then accepts", async () => {
  const agent = new ReflexiveAgent(stubProvider, { maxIterations: 2, confidenceThreshold: 70 });

  agent.agentBreaker.execute = <T>(fn: () => Promise<T>): Promise<T> => fn();
  agent.critiqueBreaker.execute = <T>(fn: () => Promise<T>): Promise<T> => fn();

  const responses = ["v1", "v2"];
  const prompts: string[] = [];
  agent.agentRunner = createMockRunner(
    (_blueprint: IBlueprint, req: IParsedRequest) => {
      prompts.push(req.userPrompt);
      const content = responses.shift() ?? "final";
      return Promise.resolve({ content, thought: "", raw: "" });
    },
  );

  agent.critiqueRunner = createMockRunner(
    () => Promise.resolve({ content: "ignored", thought: "", raw: "" }),
  );

  const critiques = [
    {
      quality: CritiqueQuality.POOR,
      confidence: 0,
      passed: false,
      issues: [],
      reasoning: "bad",
    },
    {
      quality: CritiqueQuality.GOOD,
      confidence: 80,
      passed: false,
      issues: [],
      reasoning: "better",
    },
  ];

  agent.outputValidator = createMockValidator({
    validate: <T>(_content: string, _schema: any): IValidationResult<T> => ({
      success: true,
      value: critiques.shift() as T,
      repairAttempted: false,
      repairSucceeded: false,
      raw: "",
    }),
  });

  const result = await agent.run(
    { systemPrompt: "", identityId: "agent" } satisfies IBlueprint,
    { userPrompt: "u", context: {}, traceId: "t" } satisfies IParsedRequest,
  );

  assertEquals(result.totalIterations, 2);
  assertEquals(result.earlyExit, false);
  assertEquals(result.final.content, "v2");
  assertEquals(prompts.length, 2);
  assertStringIncludes(prompts[1], "No specific improvements suggested");
  assertStringIncludes(prompts[1], "No specific issues listed");
});
