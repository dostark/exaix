/**
 * @module ReActNativeRoundSecurityTest
 * @path packages/execution/tests/react_native_round_security_test.ts
 * @description Proves the native ReAct loop validates a response against the round policy of its turn
 *   before any call executes: the response ceiling, the argument byte ceiling and the call ids.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/execution/src/native_tool_turns.ts",
 *   "packages/execution/tests/native_tool_round_security_test.ts"
 * ]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import {
  ExecutionStrategyName,
  PricingTier,
  ProviderCostTier,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
  ToolsRoundMode,
} from "@exaix/core";
import { makeGenerateResult } from "@exaix/testing";
import type { ITool, JSONValue } from "@exaix/core/types";
import type { IToolsRoundPolicy } from "@exaix/schemas";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const PROVIDER_ID = "openai-chat";
const READ_TOOL_NAME = "read_file";
const TRACE_ID = "react-native-round-security-trace";

const blueprint: IAgentFileBlueprint = {
  name: "react-native-round-security-agent",
  model: `${PROVIDER_ID}:security-model`,
  provider: PROVIDER_ID,
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "You are a test agent.",
};

const context: IExecutionContext = {
  trace_id: TRACE_ID,
  request_id: "req-react-native-round-security",
  request: "Read three files",
  plan: "Step 1",
  portal: "test",
};

const options: IAgentExecutionOptions = {
  agent_role: "react-native-round-security-agent",
  portal: "test",
  security_mode: SecurityMode.SANDBOXED,
  timeout_ms: 30_000,
  max_tool_calls: 50,
  audit_enabled: false,
  native_tools_enabled: true,
};

const READ_TOOL: ITool = {
  name: READ_TOOL_NAME,
  description: "Read one file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

const MEASURED_INPUT = {
  totalTokens: 100,
  tokenSource: "tokenizer_estimate",
  sections: { system: 100, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
} as const;

function policyOf(overrides: Partial<IToolsRoundPolicy>): IToolsRoundPolicy {
  return {
    mode: ToolsRoundMode.AUTO,
    executionCap: 4,
    concurrency: 1,
    maxResponseCalls: 64,
    maxArgumentBytes: 65536,
    maxReplayBytes: 1048576,
    resultTokenCap: 2048,
    ...overrides,
  };
}

function readCall(id: string, path = "README.md"): IProviderToolCall {
  return { id, name: READ_TOOL_NAME, input: { path }, type: "function" };
}

function toolResponse(toolCalls: IProviderToolCall[]): IGenerateResult {
  return {
    content: "",
    toolCalls,
    usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    model: "security-model",
    provider: PROVIDER_ID,
    costStatus: "unknown",
  };
}

function completedResponse(): IGenerateResult {
  const response = makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
  delete response.cost_usd;
  return { ...response, costStatus: "unknown" };
}

function registerNativeProvider(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(PROVIDER_ID, new MockProviderFactory(), {
    name: PROVIDER_ID,
    description: "Native ReAct security fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    chatFormat: "openai",
  });
}

function executorFor(getPolicy: () => IToolsRoundPolicy, executed: string[]): ReActExecutor {
  return {
    logAgentOutput: () => Promise.resolve(),
    validateReviewResult: (result: IChangesetResult) => result,
    parseAgentResponse: (_response: string, ctx: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: ctx.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    logGeneration: () => Promise.resolve(),
    getToolsRoundPolicy: getPolicy,
    toolRegistry: {
      execute: (_name: string, params: Record<string, JSONValue>) => {
        executed.push(String(params.path));
        return Promise.resolve({ success: true, data: { value: "ok" } });
      },
      getTools: () => [READ_TOOL],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
}

/** Runs ReAct against scripted responses. The policy reader sees each model turn in order. */
async function runScripted(
  responses: IGenerateResult[],
  policies: IToolsRoundPolicy[],
  executed: string[],
): Promise<void> {
  registerNativeProvider();
  try {
    let generated = 0;
    let policyReads = 0;
    const provider: IModelProvider = {
      id: PROVIDER_ID,
      measureInputTokens: () => Promise.resolve(MEASURED_INPUT),
      generate: () => Promise.resolve(responses[generated++] ?? completedResponse()),
    };
    const getPolicy = () => policies[Math.min(policyReads++, policies.length - 1)];
    await new ReActLoopStrategy(executorFor(getPolicy, executed), provider).execute(blueprint, context, options);
  } finally {
    ProviderRegistry.clear();
  }
}

const NO_SANITIZE = { sanitizeOps: false, sanitizeResources: false } as const;

Deno.test("[security] a ReAct response over the response ceiling executes no tool", NO_SANITIZE, async () => {
  const executed: string[] = [];
  const calls = [readCall("call_1"), readCall("call_2"), readCall("call_3")];
  await assertRejects(
    () => runScripted([toolResponse(calls)], [policyOf({ maxResponseCalls: 2 })], executed),
    Error,
    "call ceiling",
  );
  assertEquals(executed, []);
});

Deno.test(
  "[security] a ReAct call over the argument byte ceiling executes no tool, though a sibling is valid",
  NO_SANITIZE,
  async () => {
    const executed: string[] = [];
    const calls = [readCall("call_1"), readCall("call_2", "x".repeat(2048))];
    await assertRejects(
      () => runScripted([toolResponse(calls)], [policyOf({ maxArgumentBytes: 1024 })], executed),
      Error,
      "byte ceiling",
    );
    assertEquals(executed, []);
  },
);

Deno.test(
  "[security] a ReAct response with a duplicate call id executes no tool, though a sibling is valid",
  NO_SANITIZE,
  async () => {
    const executed: string[] = [];
    const calls = [readCall("call_1", "a.md"), readCall("call_1", "b.md")];
    await assertRejects(() => runScripted([toolResponse(calls)], [policyOf({})], executed), Error, "duplicated");
    assertEquals(executed, []);
  },
);

Deno.test(
  "[security] a ReAct response with an empty call id executes no tool, though a sibling is valid",
  NO_SANITIZE,
  async () => {
    const executed: string[] = [];
    const calls = [readCall("call_1"), readCall("  ")];
    await assertRejects(() => runScripted([toolResponse(calls)], [policyOf({})], executed), Error, "id is empty");
    assertEquals(executed, []);
  },
);

Deno.test("a ReAct ceiling change applies from the next turn", NO_SANITIZE, async () => {
  const executed: string[] = [];
  const twoCalls = (first: string, second: string) => toolResponse([readCall(first, "a.md"), readCall(second, "b.md")]);
  await assertRejects(
    () =>
      runScripted(
        [twoCalls("call_1", "call_2"), twoCalls("call_3", "call_4")],
        [policyOf({ maxResponseCalls: 64 }), policyOf({ maxResponseCalls: 1 })],
        executed,
      ),
    Error,
    "call ceiling",
  );
  assertEquals(executed, ["@test/a.md", "@test/b.md"]);
});
