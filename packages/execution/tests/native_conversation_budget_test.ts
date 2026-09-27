/**
 * @module NativeConversationBudgetTest
 * @path packages/execution/tests/native_conversation_budget_test.ts
 * @description Verifies immutable native snapshots fail the ReAct token ceiling before generation.
 * @architectural-layer Tests
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { ExecutionStrategyName, PricingTier, ProviderCostTier, SecurityMode } from "@exaix/core";
import type { IReActLoopExecutor } from "../src/react_loop_adapter.ts";
import { createMockLogger, makeGenerateResult } from "@exaix/testing";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import { OpenAIProvider } from "@exaix/ai-openai";
import { DomainEventType } from "@exaix/core/events";

const PROVIDER_ID = "openai-chat-budget-fixture";

Deno.test("native snapshot budget counts tool schema and stops before a generation that exceeds it", async () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "Compatible fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    chatFormat: "openai",
  });
  let generateCalls = 0;
  const provider: IModelProvider = {
    id: PROVIDER_ID,
    measureInputTokens: () =>
      Promise.resolve({
        totalTokens: 100,
        tokenSource: "tokenizer_estimate",
        sections: { system: 100, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
    generate() {
      generateCalls++;
      return Promise.resolve(makeGenerateResult("done"));
    },
  };
  const executor: IReActLoopExecutor = {
    logAgentOutput: () => Promise.resolve(),
    validateReviewResult: (result: IChangesetResult) => result,
    parseAgentResponse: () => ({
      branch: "test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: "test",
      tool_calls: 0,
      execution_time_ms: 0,
    }),
    logGeneration: () => Promise.resolve(),
    currentPromptBudget: {
      model: "budget-model",
      totalBudgetTokens: 10,
      safetyBufferTokens: 0,
      sections: { system: 10, plan: 10, portalKnowledge: 10, memory: 10, skills: 10, loopHistory: 10 },
    },
    tokenizer: {
      countTokens: (text) => Promise.resolve(text.length),
      countTokensBatch: (texts) => Promise.resolve(texts.map((text) => text.length)),
    },
    toolRegistry: {
      getTools: () => [{
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
      execute: () => Promise.resolve({ success: true }),
      getBaseDir: () => "/tmp",
    },
  };
  const blueprint: IAgentFileBlueprint = {
    name: "budget-test",
    model: "budget-model",
    provider: "openai-chat",
    capabilities: [ExecutionStrategyName.REACT],
    systemPrompt: "A system prompt whose token count exceeds the configured prompt ceiling.",
  };
  const context: IExecutionContext = {
    trace_id: "native-budget-trace",
    request_id: "native-budget-request",
    request: "Check the snapshot budget",
    plan: "Read a file",
    portal: "test",
  };
  const options: IAgentExecutionOptions = {
    agent_role: "budget-test",
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 30_000,
    max_tool_calls: 2,
    audit_enabled: false,
    native_tools_enabled: true,
  };

  await assertRejects(
    () => new ReActLoopStrategy(executor, provider).execute(blueprint, context, options),
    ContextBudgetExceededError,
  );
  assertEquals(generateCalls, 0);

  for (const hugeResult of [false, true]) {
    const resultText = hugeResult ? "result-body".repeat(1000) : "ok";
    const reasoning = hugeResult ? "brief" : "token-heavy-reasoning";
    const realMeasurement = new OpenAIProvider({
      apiKey: "unused-local-key",
      model: "compat-fixture-v1",
      compatible: {
        profile: "local-test",
        allow_insecure_loopback: true,
        max_response_bytes: 100_000,
        max_tool_argument_bytes: 1024,
        max_history_bytes: 100_000,
      },
      tokenizer: {
        countTokens: (text) => Promise.resolve(text.length + (text.includes("token-heavy-reasoning") ? 20_000 : 0)),
        countTokensBatch: (texts) =>
          Promise.resolve(texts.map((text) => text.length + (text.includes("token-heavy-reasoning") ? 20_000 : 0))),
      },
    });
    const logger = createMockLogger();
    let modelCalls = 0;
    let toolCalls = 0;
    const measuredTurns: number[] = [];
    const loopProvider: IModelProvider = {
      id: PROVIDER_ID,
      measureInputTokens: (prompt, opts) => {
        const snapshot = opts!.nativeConversation!;
        measuredTurns.push(snapshot.turns.length);
        if (snapshot.turns.length) {
          assertEquals(snapshot.turns.length, 1);
          assertStringIncludes(String(snapshot.turns[0].toolResultContent), resultText);
          assertEquals(snapshot.turns[0].reasoningContent, reasoning);
        }
        return realMeasurement.measureInputTokens(prompt, opts);
      },
      generate: () => {
        modelCalls++;
        return Promise.resolve({
          ...makeGenerateResult("assistant explanation"),
          toolCalls: [{ id: "budget-call-1", name: "read_file", input: { path: "file" }, reasoningContent: reasoning }],
        });
      },
    };
    const loopExecutor: IReActLoopExecutor = {
      ...executor,
      budgetLogger: logger,
      currentPromptBudget: {
        model: "budget-model",
        totalBudgetTokens: 100_000,
        safetyBufferTokens: 1000,
        sections: {
          system: 50_000,
          plan: 10_000,
          portalKnowledge: 10_000,
          memory: 10_000,
          skills: 10_000,
          loopHistory: 5000,
        },
      },
      toolRegistry: {
        ...executor.toolRegistry!,
        execute: () => {
          toolCalls++;
          return Promise.resolve({ success: true, data: resultText });
        },
      },
    };
    await assertRejects(
      () => new ReActLoopStrategy(loopExecutor, loopProvider).execute(blueprint, context, options),
      ContextBudgetExceededError,
    );
    assertEquals(modelCalls, 1);
    assertEquals(toolCalls, 1);
    assertEquals(measuredTurns, [0, 1]);
    assertEquals(logger.warn.calls.length, 1);
    assertEquals(logger.warn.calls[0].args[0], DomainEventType.ContextBudgetExceeded);
    assertEquals(logger.warn.calls[0].args[3], context.trace_id);
    assertEquals(JSON.stringify(logger.warn.calls).includes(reasoning), false);
  }
  ProviderRegistry.clear();
});
