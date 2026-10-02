/**
 * @module RateLimitedProviderCompatibleTest
 * @path packages/ai/tests/rate_limited_provider_compatible_test.ts
 * @description Verifies compatible provider identity, option forwarding and unknown-cost accounting.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai/src/rate_limited_provider.ts, packages/core/src/cost/cost_tracker.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { IModelOptions, IModelProvider } from "../src/types.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { RateLimitedProvider } from "../src/rate_limited_provider.ts";
import { DEFAULT_RATE_LIMIT_MAX_COST_PER_DAY, PricingTier, ProviderCostTier } from "@exaix/core";
import type { ICostTracker } from "@exaix/core/types";
import { createStubCostTracker } from "./helpers/service_stubs.ts";

Deno.test("compatible rate limiting preserves identity/options and journals unknown cost without estimating money", async () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "compatible fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
  });
  let forwarded: IModelOptions | undefined;
  const inner: IModelProvider = {
    id: "openai-chat-local-test",
    callCapabilities: { profile: "local-test", supportsThinking: true, supportedEffortTiers: [] },
    measureInputTokens: () =>
      Promise.resolve({
        totalTokens: 10,
        tokenSource: "tokenizer_estimate",
        sections: { system: 10, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
    generate(_prompt, options) {
      forwarded = options;
      return Promise.resolve({
        content: "ok",
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
        model: "local-test",
        provider: this.id,
        costStatus: "unknown",
      });
    },
  };
  let budgetChecks = 0;
  let unpricedRecords = 0;
  let numericRecords = 0;
  const costTracker: ICostTracker = {
    ...createStubCostTracker(),
    isWithinBudget: () => {
      budgetChecks++;
      return Promise.resolve(true);
    },
    recordUnpricedGeneration: () => {
      unpricedRecords++;
      return Promise.resolve();
    },
    trackGeneration: () => {
      numericRecords++;
      return Promise.resolve(0);
    },
  };
  const provider = new RateLimitedProvider(inner, {
    maxCallsPerMinute: 3,
    maxTokensPerHour: 100,
    maxCostPerDay: 1,
    costPer1kTokens: 100,
    costTracker,
  });
  const options: IModelOptions = {
    max_tokens: 100,
    nativeConversation: { initialPrompt: "stable", turns: [] },
    tools: [{ name: "read_file", inputSchema: { type: "object" } }],
  };

  await provider.generate("prompt", options);

  assertEquals(provider.id, inner.id);
  assertEquals(forwarded, options);
  assertEquals(provider.callsThisMinute, 1);
  assertEquals(provider.tokensThisHour > 0, true);
  assertEquals(provider.costThisDay, 0);
  assertEquals(budgetChecks, 0);
  assertEquals(unpricedRecords, 1);
  assertEquals(numericRecords, 0);
  let remoteCalls = 0;
  const remote = new RateLimitedProvider({
    ...inner,
    callCapabilities: { profile: "openai", supportsThinking: false, supportedEffortTiers: [] },
    generate: () => {
      remoteCalls++;
      return inner.generate("unused");
    },
  }, { maxCallsPerMinute: 3, maxTokensPerHour: 100, maxCostPerDay: 1, costPer1kTokens: 0 });
  await assertRejects(() => remote.generate("prompt", options), Error, "pricing_unavailable");
  assertEquals(remoteCalls, 0);
  const recorded: Array<{ costUsd?: number; costSource?: string }> = [];
  const priced = new RateLimitedProvider({
    ...inner,
    callCapabilities: { profile: "openai", supportsThinking: false, supportedEffortTiers: [] },
    estimateCallCost: (input: number, output: number) => {
      assertEquals(input, 10);
      assertEquals(output, 100);
      return Promise.resolve(0.5);
    },
    generate: async () => ({ ...await inner.generate("unused"), cost_usd: 0.25, costStatus: "estimated" }),
  }, {
    maxCallsPerMinute: 3,
    maxTokensPerHour: 100,
    maxCostPerDay: 1,
    costPer1kTokens: 999,
    costTracker: {
      ...costTracker,
      trackGeneration: (_provider: string, _model: string, usage: { costUsd?: number; costSource?: string }) => {
        recorded.push(usage);
        return Promise.resolve(usage.costUsd!);
      },
    },
  });
  await priced.generate("prompt", options);
  assertEquals(recorded[0].costSource, "registry_computed");
  assertEquals(recorded[0].costUsd, 0.25);
  assertEquals(priced.costThisDay, 0.25);
  const unpricedRemote = new RateLimitedProvider({
    ...inner,
    callCapabilities: { profile: "openai", supportsThinking: false, supportedEffortTiers: [] },
    estimateCallCost: () => Promise.resolve(0.5),
  }, { maxCallsPerMinute: 3, maxTokensPerHour: 100, maxCostPerDay: 1, costPer1kTokens: 0, costTracker });
  await assertRejects(() => unpricedRemote.generate("prompt", options), Error, "pricing_unavailable");
  assertEquals(unpricedRecords, 2);
  assertEquals(unpricedRemote.callsThisMinute, 1);
  assertEquals(unpricedRemote.tokensThisHour, 10);
  await assertRejects(() => unpricedRemote.generate("prompt", options), Error, "pricing_unavailable");
  assertEquals(unpricedRecords, 2);
  await assertRejects(
    () =>
      new RateLimitedProvider({
        ...inner,
        measureInputTokens: () =>
          Promise.resolve({
            totalTokens: 101,
            tokenSource: "tokenizer_estimate",
            sections: { system: 1, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 100 },
          }),
        generate: () => {
          throw new Error("must stop before generate");
        },
      }, { maxCallsPerMinute: 3, maxTokensPerHour: 100, maxCostPerDay: 1, costPer1kTokens: 0 }).generate(
        "short",
        options,
      ),
    Error,
    "tokens per hour",
  );
  ProviderRegistry.clear();
});

Deno.test("[phase203.rate-limit] a self-hosted call under default limits succeeds and records an unknown cost", async () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "compatible fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
  });
  let budgetChecks = 0;
  let unpricedRecords = 0;
  let numericRecords = 0;
  const costTracker: ICostTracker = {
    ...createStubCostTracker(),
    isWithinBudget: () => {
      budgetChecks++;
      return Promise.resolve(true);
    },
    recordUnpricedGeneration: () => {
      unpricedRecords++;
      return Promise.resolve();
    },
    trackGeneration: () => {
      numericRecords++;
      return Promise.resolve(0);
    },
  };
  const inner: IModelProvider = {
    id: "openai-chat-llama3.1:8b",
    callCapabilities: { profile: "self-hosted", supportsThinking: false, supportedEffortTiers: [] },
    measureInputTokens: () =>
      Promise.resolve({
        totalTokens: 10,
        tokenSource: "tokenizer_estimate",
        sections: { system: 10, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
    generate() {
      return Promise.resolve({
        content: "ok",
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
        model: "llama3.1:8b",
        provider: this.id,
        costStatus: "unknown",
      });
    },
  };
  const provider = new RateLimitedProvider(inner, {
    maxCallsPerMinute: 3,
    maxTokensPerHour: 100,
    maxCostPerDay: DEFAULT_RATE_LIMIT_MAX_COST_PER_DAY,
    costPer1kTokens: 100,
    costTracker,
  });
  const options: IModelOptions = {
    max_tokens: 100,
    nativeConversation: { initialPrompt: "stable", turns: [] },
    tools: [{ name: "read_file", inputSchema: { type: "object" } }],
  };

  const result = await provider.generate("prompt", options);

  assertEquals(result.costStatus, "unknown");
  assertEquals(provider.costThisDay, 0);
  assertEquals(budgetChecks, 0);
  assertEquals(unpricedRecords, 1);
  assertEquals(numericRecords, 0);
  ProviderRegistry.clear();
});
