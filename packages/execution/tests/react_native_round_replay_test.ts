/**
 * @module ReActNativeRoundReplayTest
 * @path packages/execution/tests/react_native_round_replay_test.ts
 * @description Proves the ReAct loop replays a provider's parallel calls as one completed round, with the
 *   model's own assistant parts, when the provider declares whole-round replay. A per-call replay of the same
 *   response would send the second call unsigned, which Gemini rejects.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/execution/src/native_tool_turns.ts",
 *   "packages/execution/tests/react_native_round_security_test.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelOptions, IModelProvider, JSONObject } from "@exaix/ai/types.ts";
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
} from "@exaix/core";
import { makeGenerateResult } from "@exaix/testing";
import type { ITool, JSONValue } from "@exaix/core/types";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const PROVIDER_ID = "google-gemini-replay";
const READ_TOOL_NAME = "read_file";
const TRACE_ID = "react-native-round-replay-trace";

const blueprint: IAgentFileBlueprint = {
  name: "react-native-round-replay-agent",
  model: `${PROVIDER_ID}:replay-model`,
  provider: PROVIDER_ID,
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "You are a test agent.",
};

const context: IExecutionContext = {
  trace_id: TRACE_ID,
  request_id: "req-react-native-round-replay",
  request: "Read two files",
  plan: "Step 1",
  portal: "test",
};

const options: IAgentExecutionOptions = {
  agent_role: "react-native-round-replay-agent",
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

/** The model's two parallel calls as Gemini returns them: the signature rides on the first part only. */
const MODEL_PARTS: JSONObject[] = [
  { functionCall: { name: READ_TOOL_NAME, args: { path: "a.txt" } }, thoughtSignature: "sig-a" },
  { functionCall: { name: READ_TOOL_NAME, args: { path: "b.txt" } } },
];

function parallelResponse(): IGenerateResult {
  const toolCalls: IProviderToolCall[] = [
    { id: "call-a", name: READ_TOOL_NAME, input: { path: "a.txt" }, type: "function", thoughtSignature: "sig-a" },
    { id: "call-b", name: READ_TOOL_NAME, input: { path: "b.txt" }, type: "function" },
  ];
  return {
    content: "",
    toolCalls,
    nativeAssistantReplay: { provider: "google", parts: MODEL_PARTS },
    usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    model: "replay-model",
    provider: PROVIDER_ID,
    costStatus: "unknown",
  };
}

function completedResponse(): IGenerateResult {
  const response = makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
  delete response.cost_usd;
  return { ...response, costStatus: "unknown" };
}

function registerGoogleReplayProvider(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("google", new MockProviderFactory(), {
    name: "google",
    description: "Whole-round replay fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsParallelToolReplay: true,
    supportsNativeConversation: true,
    supportsNativeRoundReplay: true,
    chatFormat: "openai",
  });
}

function executorFor(executed: string[]): ReActExecutor {
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
    toolRegistry: {
      execute: (_name: string, params: Record<string, JSONValue>) => {
        executed.push(String(params.path));
        return Promise.resolve({ success: true, data: { value: `content of ${String(params.path)}` } });
      },
      getTools: () => [READ_TOOL],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
}

const NO_SANITIZE = { sanitizeOps: false, sanitizeResources: false } as const;

Deno.test({
  name:
    "[google-native] a ReAct round of parallel calls is replayed whole, with the model's own parts, on the next request",
  ...NO_SANITIZE,
  fn: async () => {
    registerGoogleReplayProvider();
    try {
      const executed: string[] = [];
      const requests: IModelOptions[] = [];
      const responses: IGenerateResult[] = [parallelResponse(), completedResponse()];
      const provider: IModelProvider = {
        id: PROVIDER_ID,
        measureInputTokens: () => Promise.resolve(MEASURED_INPUT),
        generate: (_prompt: string, requestOptions?: IModelOptions) => {
          requests.push(requestOptions ?? {});
          return Promise.resolve(responses[requests.length - 1] ?? completedResponse());
        },
      };
      await new ReActLoopStrategy(executorFor(executed), provider).execute(blueprint, context, options);

      assertEquals(executed.map((path) => path.replace(/^@test\//, "")), ["a.txt", "b.txt"]);
      const replay = requests[1].nativeConversation;
      assertEquals(replay?.turns, []);
      assertEquals(replay?.rounds?.length, 1);
      assertEquals(replay?.rounds?.[0].calls.map((call) => call.toolUseId), ["call-a", "call-b"]);
      assertEquals(replay?.rounds?.[0].assistant, { provider: "google", parts: MODEL_PARTS });
    } finally {
      ProviderRegistry.clear();
    }
  },
});
