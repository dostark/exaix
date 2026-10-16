/**
 * @module ReActLoopNativeToolsGateMultiProviderTest
 * @path packages/execution/tests/react_loop_native_tools_gate_multi_provider_test.ts
 * @description Phase 153 Step 1 — proves `ReActLoopStrategy`'s native-tools gate
 * (`options.native_tools_enabled === true && ProviderRegistry.getProviderMetadata(this.provider.id)
 * ?.supportsNativeTools === true`, react_loop_strategy.ts:164-165) is genuinely
 * provider-name-agnostic: it fires for ANY provider id whose registered metadata carries
 * `supportsNativeTools: true`, not just `"anthropic"`. Drives the real gate through
 * `execute()` rather than re-implementing the condition — the gate's first observable
 * effect is calling `executor.toolRegistry.getTools()` (only reached when the gate is
 * true; see react_loop_strategy.ts:169-173), which this test counts.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/ai/src/provider_registry.ts",
 *   "packages/ai/tests/providers/provider_registry_native_tools_metadata_test.ts"
 * ]
 */

import { assertEquals, assertExists, assertFalse, assertRejects, assertStringIncludes } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { RateLimitedProvider } from "@exaix/ai/rate_limited_provider.ts";
import { TracedProvider } from "@exaix/ai/traced_provider.ts";
import {
  ExecutionStrategyName,
  PricingTier,
  ProviderCostTier,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
} from "@exaix/core";
import { createMockLogger, makeGenerateResult } from "@exaix/testing";
import type { ITool, JSONValue } from "@exaix/core/types";
import type { IToolsRoundPolicy } from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";
import { PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX, ToolsRoundMode } from "@exaix/core";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const NON_ANTHROPIC_PROVIDER_ID = "openai-test";

const testBlueprint: IAgentFileBlueprint = {
  name: "gate-multi-provider-test-agent",
  model: `${NON_ANTHROPIC_PROVIDER_ID}:some-model`,
  provider: NON_ANTHROPIC_PROVIDER_ID,
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "You are a test agent.",
};

const testContext: IExecutionContext = {
  trace_id: "gate-multi-provider-trace-0001",
  request_id: "req-gate-multi-provider-1",
  request: "Run native-tools gate test",
  plan: "Step 1",
  portal: "test",
};

function makeOptions(nativeToolsEnabled: boolean): IAgentExecutionOptions {
  return {
    agent_role: "gate-multi-provider-agent",
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 30_000,
    max_tool_calls: 10,
    audit_enabled: false,
    native_tools_enabled: nativeToolsEnabled,
  };
}

/** Executor whose toolRegistry.getTools() is only reachable when the gate evaluates true
 *  (react_loop_strategy.ts:170-171: `this.executor.toolRegistry?.getTools() ?? []`). */
function makeTrackingExecutor(
  getToolsCalls: { count: number },
  tool?: Opt<ITool, Reason.OptionalInput>,
  generationRecords?: Opt<Array<{ costUsd?: number; costSource?: string }>, Reason.OptionalContext>,
): ReActExecutor {
  return {
    logAgentOutput: () => Promise.resolve(),
    validateReviewResult: (r: IChangesetResult) => r,
    parseAgentResponse: (_r: string, ctx: IExecutionContext, t: number): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: ctx.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - t,
    }),
    logGeneration: (_traceId, _role, _model, _provider, usage) => {
      generationRecords?.push({ costUsd: usage.costUsd, costSource: usage.costSource });
      return Promise.resolve();
    },
    toolRegistry: {
      execute: () => Promise.resolve({ success: true, data: { value: "OBSERVATION_SENTINEL" } }),
      getTools: () => {
        getToolsCalls.count++;
        return tool ? [tool] : [];
      },
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
}

for (const status of ["unknown", "tracked"] as const) {
  Deno.test(`OpenRouter ${status} usage uses catalog prediction only when usage.cost is missing`, async () => {
    ProviderRegistry.clear();
    let lookups = 0;
    ProviderRegistry.registerWithMetadata("openrouter", new MockProviderFactory(), {
      name: "openrouter",
      description: "Catalog fixture",
      capabilities: ["chat"],
      strengths: [],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      isAggregator: true,
      modelInfo: () => {
        lookups++;
        return Promise.resolve({ inputPerMtok: 3, outputPerMtok: 15 });
      },
    });
    try {
      const records: Array<{ costUsd?: number; costSource?: string }> = [];
      const provider: IModelProvider = {
        id: "rate-limited-openrouter-vendor-model",
        generate: () =>
          Promise.resolve({
            content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
            usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
            model: "vendor/catalog-model",
            provider: "openrouter",
            costStatus: status,
            ...(status === "tracked" ? { cost_usd: 0.123 } : {}),
          }),
      };
      const result = await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, undefined, records), provider)
        .execute(testBlueprint, testContext, makeOptions(false));
      assertEquals(result.usage?.cost_usd, status === "tracked" ? 0.123 : 18);
      assertEquals(result.usage?.cost_source, "predicted");
      assertEquals(records[0], { costUsd: status === "tracked" ? 0.123 : 18, costSource: "predicted" });
      assertEquals(lookups, status === "tracked" ? 0 : 1);
    } finally {
      ProviderRegistry.clear();
    }
  });
}

/** Provider that immediately completes the ReAct loop on its first generate() call. */
function makeCompleteProvider(id: string): IModelProvider {
  return {
    id,
    generate: () => Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`)),
  };
}

Deno.test("[security] compatible unknown-cost policy is preserved even when a catalog price or overlay exists", async () => {
  ProviderRegistry.clear();
  let lookups = 0;
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "Compatible fixture",
    capabilities: ["chat"],
    strengths: [],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    compatibleCallPolicy: true,
    modelInfo: () => {
      lookups++;
      return Promise.resolve({ inputPerMtok: 3, outputPerMtok: 15 });
    },
  });
  try {
    const records: Array<{ costUsd?: number; costSource?: string }> = [];
    const provider: IModelProvider = {
      id: "openai-chat-compatible-fixture",
      generate: () =>
        Promise.resolve({
          content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
          usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
          provider: "anthropic",
          model: "claude-sonnet-5",
          costStatus: "unknown",
        }),
    };
    const result = await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, undefined, records), provider)
      .execute(testBlueprint, testContext, makeOptions(false));
    assertEquals(result.usage?.cost_usd, null);
    assertEquals(records, [{ costUsd: undefined, costSource: "unknown" }]);
    assertEquals(lookups, 0);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("ordinary ReAct providers retain the legacy omitted-cost and journal payload defaults", async () => {
  const records: Array<{ costUsd?: number; costSource?: string }> = [];
  const provider: IModelProvider = {
    id: "ordinary-fixture",
    generate: () =>
      Promise.resolve({
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "unlisted-fixture",
        provider: "mock",
      }),
  };
  const result = await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, undefined, records), provider).execute(
    testBlueprint,
    testContext,
    makeOptions(false),
  );
  assertEquals(result.usage?.cost_usd, 0);
  assertEquals(records, [{ costUsd: 0, costSource: undefined }]);
});

Deno.test("compatible priced usage keeps the provider policy result without generic registry repricing", async () => {
  const records: Array<{ costUsd?: number; costSource?: string }> = [];
  const provider: IModelProvider = {
    id: "priced-fixture",
    generate: () =>
      Promise.resolve({
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        model: "claude-sonnet-5",
        provider: "anthropic",
        costStatus: "estimated",
        cost_usd: 0.123,
      }),
  };
  const result = await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, undefined, records), provider).execute(
    testBlueprint,
    testContext,
    makeOptions(false),
  );
  assertEquals(records[0].costUsd, 0.123);
  assertEquals(result.usage?.cost_usd, 0.123);
});

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate fires for a non-anthropic provider id registered with supportsNativeTools:true",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider for the multi-provider gate proof",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(NON_ANTHROPIC_PROVIDER_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(getToolsCalls.count, 1);
  },
);

Deno.test(
  "[phase155.snapshot] ReAct keeps its first prompt and replays completed observations only in the snapshot",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const providerId = "openai-chat-fixture-model";
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
    const tool: ITool = {
      name: "read_file",
      description: "Read one file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    };
    const getToolsCalls = { count: 0 };
    const generationRecords: Array<{ costUsd?: number; costSource?: string }> = [];
    const calls: Array<{ prompt: string; options?: IModelOptions }> = [];
    const provider: IModelProvider = {
      id: providerId,
      measureInputTokens: () =>
        Promise.resolve({
          totalTokens: 100,
          tokenSource: "tokenizer_estimate",
          sections: { system: 100, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
        }),
      generate(prompt, options) {
        calls.push({ prompt, options });
        if (calls.length <= 2) {
          const response = makeGenerateResult("");
          delete response.cost_usd;
          return Promise.resolve({
            ...response,
            costStatus: "unknown",
            toolCalls: [{
              id: `call_${calls.length}`,
              name: "read_file",
              input: { path: "README.md" },
              type: "function",
            }],
          });
        }
        const response = makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
        delete response.cost_usd;
        return Promise.resolve({ ...response, costStatus: "unknown" });
      },
    };
    const strategy = new ReActLoopStrategy(makeTrackingExecutor(getToolsCalls, tool, generationRecords), provider);
    const result = await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(calls.length, 3);
    assertEquals(calls[0].prompt, calls[1].prompt);
    assertEquals(calls[1].prompt, calls[2].prompt);
    assertStringIncludes(calls[0].prompt, testBlueprint.systemPrompt);
    assertEquals(calls[2].options?.nativeConversation?.turns.length, 2);
    assertEquals(
      calls[1].options?.nativeConversation?.roundInstruction === calls[2].options?.nativeConversation?.roundInstruction,
      false,
    );
    assertExists(calls[0].options?.nativeConversation);
    assertEquals(calls[0].options!.nativeConversation!.turns.length, 0);
    assertExists(calls[1].options?.nativeConversation);
    assertEquals(calls[1].options!.nativeConversation!.turns.length, 1);
    assertStringIncludes(
      String(calls[1].options!.nativeConversation!.turns[0].toolResultContent),
      "OBSERVATION_SENTINEL",
    );
    assertFalse(calls[1].prompt.includes("OBSERVATION_SENTINEL"));
    assertEquals(result.usage?.cost_usd, null);
    assertEquals(result.usage?.cost_source, "unknown");
    assertEquals(
      generationRecords.every((record) => record.costUsd === undefined && record.costSource === "unknown"),
      true,
    );
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate stays false when native_tools_enabled is true but the provider's metadata omits supportsNativeTools",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider without native-tools capability",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      // supportsNativeTools intentionally omitted.
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(NON_ANTHROPIC_PROVIDER_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(getToolsCalls.count, 0);
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] production shape: composite provider.id (openai-opus) matches bare-type metadata (openai) with supportsNativeTools",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // Production provider instances carry a composite id "<type>-<model>" (ProviderFactory
    // generateId), while ProviderRegistry metadata is keyed by the BARE type. The gate must
    // fall back from the composite id to its type prefix, or native tool-calling never fires.
    const BARE_TYPE = "openai";
    const COMPOSITE_ID = "openai-gpt-5-mini";
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(BARE_TYPE, new MockProviderFactory(), {
      name: BARE_TYPE,
      description: "Bare-type provider registry entry (production shape)",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(COMPOSITE_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(
      getToolsCalls.count,
      1,
      "composite provider.id must resolve to bare-type metadata, or native tools never enable",
    );
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate stays false when the capable provider's opt-in flag is unset",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider with native-tools capability",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(NON_ANTHROPIC_PROVIDER_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(false));

    assertEquals(getToolsCalls.count, 0);
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate does not crash when provider.id is undefined (Step 11 composite-id fallback must stay nil-safe — budget-test regression)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider with native-tools capability",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    // Omit `id` entirely — the budget-test mock provider shape (react_loop_strategy_budget_test.ts).
    const idlessProvider = {
      generate(_prompt: string) {
        return Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`));
      },
    } as IModelProvider;
    const strategy = new ReActLoopStrategy(makeTrackingExecutor(getToolsCalls), idlessProvider);

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    // Without an id the metadata lookup is undefined; the gate must simply stay off,
    // not throw a TypeError reading `providerIdForGate.indexOf("-")`.
    assertEquals(getToolsCalls.count, 0);
  },
);

const TOOL_CHOICE_PROVIDER_ID = "native-tool-choice-fixture";

/** The capability a self-hosted service publishes when it cannot honor an explicit tool_choice. */
const NO_TOOL_CHOICE_CAPABILITY: NonNullable<IModelProvider["callCapabilities"]> = {
  profile: "self-hosted",
  supportsThinking: false,
  supportedEffortTiers: [],
  supportsToolChoice: false,
};

const READ_FILE_TOOL: ITool = {
  name: "read_file",
  description: "Read one file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

const PATCH_FILE_TOOL: ITool = {
  name: "patch_file",
  description: "Patch one file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

function registerToolChoiceProvider(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(TOOL_CHOICE_PROVIDER_ID, new MockProviderFactory(), {
    name: TOOL_CHOICE_PROVIDER_ID,
    description: "Native tool-choice gate fixture provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
}

/** Provider that records every generate() call and completes the loop on the first one. */
function makeRecordingProvider(callCapabilities?: Opt<IModelProvider["callCapabilities"], Reason.OptionalContext>): {
  provider: IModelProvider;
  calls: Array<{ prompt: string; options?: IModelOptions }>;
} {
  const calls: Array<{ prompt: string; options?: IModelOptions }> = [];
  return {
    calls,
    provider: {
      id: TOOL_CHOICE_PROVIDER_ID,
      callCapabilities,
      generate(prompt, options) {
        calls.push({ prompt, options });
        return Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`));
      },
    },
  };
}

/** A plan matching the targeted-edit pattern, so the loop derives the preferred tool patch_file. */
function targetedEditContext(): IExecutionContext {
  return { ...testContext, plan: "Fix the null guard" };
}

function nativeOptions(permittedTools: string[]): IAgentExecutionOptions {
  return { ...makeOptions(true), permitted_tools: permittedTools };
}

/** nativeToolChoiceMode rides on the strategy's options object but is not wire IModelOptions. */
function toolChoiceModeOf(options?: Opt<IModelOptions, Reason.OptionalInput>): string | undefined {
  return (options as { nativeToolChoiceMode?: string } | undefined)?.nativeToolChoiceMode;
}

Deno.test(
  "[phase203.react] a supportsToolChoice=false provider sends tools with no tool_choice",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_TOOL_CHOICE_CAPABILITY);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, READ_FILE_TOOL), provider);

    await strategy.execute(testBlueprint, testContext, nativeOptions(["read_file"]));

    assertEquals(calls.length, 1);
    assertEquals(calls[0].options?.tools?.map((tool) => tool.name), ["read_file"]);
    assertEquals("toolChoice" in (calls[0].options ?? {}), false);
    assertEquals(toolChoiceModeOf(calls[0].options), undefined);
  },
);

Deno.test(
  "[phase203.react] a supportsToolChoice=false provider suppresses the forced-tool branch too",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_TOOL_CHOICE_CAPABILITY);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), provider);

    await strategy.execute(testBlueprint, targetedEditContext(), nativeOptions(["patch_file"]));

    assertEquals(calls[0].options?.tools?.map((tool) => tool.name), ["patch_file"]);
    assertEquals("toolChoice" in (calls[0].options ?? {}), false);
    assertEquals(toolChoiceModeOf(calls[0].options), undefined);
  },
);

/** The capability the DeepSeek profile publishes: thinking mode accepts tool_choice "auto" only. */
const NO_FORCED_CHOICE_WITH_THINKING: NonNullable<IModelProvider["callCapabilities"]> = {
  profile: "deepseek",
  supportsThinking: true,
  supportedEffortTiers: ["low", "medium", "high"],
  effortRequiresThinking: true,
  supportsForcedToolChoiceWithThinking: false,
};

Deno.test(
  "[react] a thinking call relaxes the forced tool to auto when the provider refuses forced choice with thinking",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_FORCED_CHOICE_WITH_THINKING);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), provider);
    strategy.callOptions = { thinking: true, effort: "high" };

    await strategy.execute(testBlueprint, targetedEditContext(), nativeOptions(["patch_file"]));

    assertEquals(calls[0].options?.toolChoice, { type: "auto" });
    assertEquals(toolChoiceModeOf(calls[0].options), "auto");
    assertEquals(calls[0].options?.thinking, true);
  },
);

Deno.test(
  "[react] the same provider keeps the forced tool when thinking is off",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_FORCED_CHOICE_WITH_THINKING);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), provider);
    strategy.callOptions = { thinking: false };

    await strategy.execute(testBlueprint, targetedEditContext(), nativeOptions(["patch_file"]));

    assertEquals(calls[0].options?.toolChoice, { type: "tool", name: "patch_file" });
    assertEquals(toolChoiceModeOf(calls[0].options), "forced");
  },
);

Deno.test(
  "[react] an unset thinking flag relaxes the forced tool to auto, because the DeepSeek model thinks by default",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_FORCED_CHOICE_WITH_THINKING);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), provider);

    await strategy.execute(testBlueprint, targetedEditContext(), nativeOptions(["patch_file"]));

    assertEquals(calls[0].options?.toolChoice, { type: "auto" });
    assertEquals(toolChoiceModeOf(calls[0].options), "auto");
  },
);

/** The capability of a model that refuses forced tool_choice in every thinking mode, as Opus 5.5 and Sonnet 5.5 do. */
const NO_FORCED_CHOICE_ANY_THINKING: NonNullable<IModelProvider["callCapabilities"]> = {
  profile: "anthropic",
  supportsThinking: true,
  supportedEffortTiers: ["low", "medium", "high"],
  supportsForcedToolChoice: false,
};

Deno.test(
  "[react] a model that refuses forced choice in every mode relaxes the forced tool to auto, even with thinking unset",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_FORCED_CHOICE_ANY_THINKING);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), provider);

    await strategy.execute(testBlueprint, targetedEditContext(), nativeOptions(["patch_file"]));

    assertEquals(calls[0].options?.toolChoice, { type: "auto" });
    assertEquals(toolChoiceModeOf(calls[0].options), "auto");
  },
);

Deno.test(
  "[react] a model that refuses forced choice in every mode also relaxes it when thinking is off",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_FORCED_CHOICE_ANY_THINKING);
    const strategy = new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), provider);
    strategy.callOptions = { thinking: false };

    await strategy.execute(testBlueprint, targetedEditContext(), nativeOptions(["patch_file"]));

    assertEquals(calls[0].options?.toolChoice, { type: "auto" });
  },
);

Deno.test(
  "[phase203.react] a default provider still forces any, and a preferred tool still forces that tool",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const plain = makeRecordingProvider();
    await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, READ_FILE_TOOL), plain.provider).execute(
      testBlueprint,
      testContext,
      nativeOptions(["read_file"]),
    );
    assertEquals(plain.calls[0].options?.toolChoice, { type: "any" });
    assertEquals(toolChoiceModeOf(plain.calls[0].options), "any");

    const forced = makeRecordingProvider();
    await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, PATCH_FILE_TOOL), forced.provider).execute(
      testBlueprint,
      targetedEditContext(),
      nativeOptions(["patch_file"]),
    );
    assertEquals(forced.calls[0].options?.toolChoice, { type: "tool", name: "patch_file" });
    assertEquals(toolChoiceModeOf(forced.calls[0].options), "forced");
  },
);

Deno.test(
  "[phase203.react] the gate reads the capability through TracedProvider and RateLimitedProvider",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    registerToolChoiceProvider();
    const { provider, calls } = makeRecordingProvider(NO_TOOL_CHOICE_CAPABILITY);
    const decorated = new RateLimitedProvider(new TracedProvider(provider, createMockLogger()), {
      maxCallsPerMinute: 10,
      maxTokensPerHour: 100_000,
      maxCostPerDay: 10,
      costPer1kTokens: 0,
    });

    await new ReActLoopStrategy(makeTrackingExecutor({ count: 0 }, READ_FILE_TOOL), decorated).execute(
      testBlueprint,
      testContext,
      nativeOptions(["read_file"]),
    );

    assertEquals(calls[0].options?.tools?.map((tool) => tool.name), ["read_file"]);
    assertEquals("toolChoice" in (calls[0].options ?? {}), false);
  },
);

function roundPolicy(mode: ToolsRoundMode, executionCap: number): IToolsRoundPolicy {
  return {
    mode,
    executionCap,
    concurrency: 1,
    maxResponseCalls: 64,
    maxArgumentBytes: 65536,
    maxReplayBytes: 1048576,
    resultTokenCap: 2048,
  };
}

/** A native executor that reads its round policy from the given reader and records every execution. */
function policyExecutor(getPolicy: () => IToolsRoundPolicy, executed: string[], journal: string[] = []): ReActExecutor {
  const base = makeTrackingExecutor({ count: 0 }, READ_TOOL_FOR_POLICY);
  return {
    ...base,
    getToolsRoundPolicy: getPolicy,
    logDynamicToolCall: (_traceId, _tool, _params, resultSummary) => {
      journal.push(resultSummary);
      return Promise.resolve();
    },
    toolRegistry: {
      ...base.toolRegistry!,
      execute: (_name: string, params: Record<string, JSONValue>) => {
        executed.push(String(params.path));
        return Promise.resolve({ success: true, data: { value: "policy-ok" } });
      },
    },
  };
}

const READ_TOOL_FOR_POLICY: ITool = {
  name: "read_file",
  description: "Read one file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

/** One response carrying three reads, then a completed answer, on the grouped openai-chat fixture. */
async function runThreeReads(
  policy: IToolsRoundPolicy,
  executed: string[] = [],
  maxToolCalls = 10,
  journal: string[] = [],
): Promise<{ calls: Array<{ options?: IModelOptions }>; toolCalls: number }> {
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
  const calls: Array<{ options?: IModelOptions }> = [];
  const provider: IModelProvider = {
    id: "openai-chat-policy-fixture",
    measureInputTokens: () =>
      Promise.resolve({
        totalTokens: 100,
        tokenSource: "tokenizer_estimate",
        sections: { system: 100, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
    generate(_prompt, options) {
      calls.push({ options });
      if (calls.length === 1) {
        return Promise.resolve({
          content: "",
          toolCalls: ["call_1", "call_2", "call_3"].map((id) => ({
            id,
            name: "read_file",
            input: { path: "README.md" },
            type: "function",
          })),
          usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
          model: "policy-model",
          provider: "openai-chat",
          costStatus: "unknown",
        });
      }
      const response = makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
      delete response.cost_usd;
      return Promise.resolve({ ...response, costStatus: "unknown" });
    },
  };
  const strategy = new ReActLoopStrategy(policyExecutor(() => policy, executed, journal), provider);
  const result = await strategy.execute(testBlueprint, testContext, {
    ...makeOptions(true),
    max_tool_calls: maxToolCalls,
  });
  return { calls, toolCalls: result.tool_calls };
}

Deno.test("[react policy] off alone executes one of three native calls and replays each refusal", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const executed: string[] = [];
  const { calls } = await runThreeReads(roundPolicy(ToolsRoundMode.OFF, 1), executed);

  assertEquals(executed.length, 1);
  const turns = calls[1].options?.nativeConversation?.turns ?? [];
  assertEquals(turns.map((turn) => turn.toolResultIsError), [false, true, true]);
  assertStringIncludes(String(turns[1].toolResultContent), "tool call limit reached");
});

Deno.test("[react policy] auto executes every native call up to the loop cap and sends no refusal", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const executed: string[] = [];
  const { calls } = await runThreeReads(roundPolicy(ToolsRoundMode.AUTO, 4), executed);

  assertEquals(executed.length, 3);
  const turns = calls[1].options?.nativeConversation?.turns ?? [];
  assertEquals(turns.map((turn) => turn.toolResultIsError), [false, false, false]);
});

Deno.test("[react policy] a native tool result is capped to the policy result tokens before it is replayed", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const RESULT_TOKEN_CAP = 128;
  const oversized = "x".repeat(5000);
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
  const calls: Array<{ options?: IModelOptions }> = [];
  const provider: IModelProvider = {
    id: "openai-chat-cap-fixture",
    measureInputTokens: () =>
      Promise.resolve({
        totalTokens: 100,
        tokenSource: "tokenizer_estimate",
        sections: { system: 100, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
    generate(_prompt, options) {
      calls.push({ options });
      if (calls.length === 1) {
        return Promise.resolve({
          content: "",
          toolCalls: [{ id: "call_big", name: "read_file", input: { path: "README.md" }, type: "function" }],
          usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
          model: "policy-model",
          provider: "openai-chat",
          costStatus: "unknown",
        });
      }
      const response = makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
      delete response.cost_usd;
      return Promise.resolve({ ...response, costStatus: "unknown" });
    },
  };
  const base = makeTrackingExecutor({ count: 0 }, READ_TOOL_FOR_POLICY);
  const executor: ReActExecutor = {
    ...base,
    getToolsRoundPolicy: () => ({ ...roundPolicy(ToolsRoundMode.AUTO, 4), resultTokenCap: RESULT_TOKEN_CAP }),
    toolRegistry: {
      ...base.toolRegistry!,
      execute: () => Promise.resolve({ success: true, data: { value: oversized } }),
    },
  };
  const strategy = new ReActLoopStrategy(executor, provider);
  await strategy.execute(testBlueprint, testContext, makeOptions(true));

  const replayed = String(calls[1].options?.nativeConversation?.turns[0].toolResultContent);
  assertEquals(replayed.length <= RESULT_TOKEN_CAP * 4 + PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX.length, true);
  assertStringIncludes(replayed, PLANNING_TOOL_RESULT_TRUNCATED_SUFFIX);
});

Deno.test(
  "[react policy] the whole-run tool-call allowance refuses a native response of three calls before any executes",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const executed: string[] = [];
    await assertRejects(
      () => runThreeReads(roundPolicy(ToolsRoundMode.AUTO, 4), executed, 2),
      Error,
      "Exceeded maximum tool calls",
    );
    assertEquals(executed.length, 0);
  },
);

Deno.test(
  "[react policy] off with a small allowance executes one of three native calls and refuses two",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const executed: string[] = [];
    const { calls } = await runThreeReads(roundPolicy(ToolsRoundMode.OFF, 1), executed, 2);

    assertEquals(executed.length, 1);
    const turns = calls[1].options?.nativeConversation?.turns ?? [];
    assertEquals(turns.map((turn) => turn.toolResultIsError), [false, true, true]);
  },
);

Deno.test(
  "[react policy] a call refused by the cap is journaled with the limit message and not counted",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const executed: string[] = [];
    const journal: string[] = [];
    const { toolCalls } = await runThreeReads(roundPolicy(ToolsRoundMode.OFF, 1), executed, 10, journal);

    assertEquals(executed.length, 1);
    assertEquals(journal.length, 3, "every returned call leaves a journal row");
    assertEquals(journal.filter((summary) => summary.includes("tool call limit reached")).length, 2);
    assertEquals(toolCalls, 1, "only the executed call counts");
  },
);
