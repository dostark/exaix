/**
 * @module RateLimitedProviderGlobalBudgetTest
 * @path packages/ai/tests/rate_limited_provider_global_budget_test.ts
 * @description Step-8 coverage: when a binding identity and finite daily caps are present,
 *   RateLimitedProvider admits cloud calls against a global cap summed over services and a
 *   per-service cap, never lets priced or unpriced local usage consume the cloud budget,
 *   keeps the legacy per-provider cap outside the binding mode, counts the boot provider
 *   against the global cap while its predicate is true, activates the cap for a per-run-only
 *   overlay, and under concurrency admits at most one call at the remaining headroom.
 * @architectural-layer Tests
 * @related-files [packages/ai/src/rate_limited_provider.ts, packages/core/src/cost/cost_tracker.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import type { IModelOptions, IModelProvider } from "../src/types.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { RateLimitedProvider, RateLimiterError } from "../src/rate_limited_provider.ts";
import { ProviderCallPolicyError } from "../src/errors.ts";
import { CostTracker } from "@exaix/core/cost";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { ICostTracker } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";

function baseInner(): IModelProvider {
  return {
    id: "openai-chat-bound",
    callCapabilities: { profile: "openai", supportsThinking: false, supportedEffortTiers: [] },
    measureInputTokens: () =>
      Promise.resolve({
        totalTokens: 5000,
        tokenSource: "tokenizer_estimate",
        sections: { system: 5000, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
      }),
    estimateCallCost: (_input: number, _output: number) => Promise.resolve(0.05),
    generate: (_prompt, _options) =>
      Promise.resolve({
        content: "ok",
        usage: { promptTokens: 5000, completionTokens: 5000, totalTokens: 10000 },
        model: "bound",
        provider: "openai-chat-bound",
        costStatus: "estimated" as const,
        cost_usd: 0.05,
      }),
  };
}

function fixtureOptions(): IModelOptions {
  return {
    max_tokens: 100,
    nativeConversation: { initialPrompt: "stable", turns: [] },
  };
}

function registerCompatible(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "binding fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
  });
}

async function withBudgetTracker(
  testFn: (tracker: CostTracker) => Promise<void>,
): Promise<void> {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await testFn(tracker);
    await db.close();
  } finally {
    await cleanup();
  }
}

function makeProvider(
  tracker: ICostTracker,
  overrides: {
    service?: string;
    transport?: "cloud" | "local";
    dailyCostCapUsd?: number;
    globalCapUsd?: number;
    globalBudget?: () => Promise<boolean>;
    maxCostPerDay?: number;
  } = {},
  inner: IModelProvider = baseInner(),
): RateLimitedProvider {
  const bindingIdentity = overrides.service
    ? {
      service: overrides.service,
      transport: overrides.transport ?? "cloud",
      ...(overrides.dailyCostCapUsd !== undefined ? { dailyCostCapUsd: overrides.dailyCostCapUsd } : {}),
    }
    : undefined;
  return new RateLimitedProvider(inner, {
    maxCallsPerMinute: Infinity,
    maxTokensPerHour: Infinity,
    maxCostPerDay: overrides.maxCostPerDay ?? Infinity,
    costPer1kTokens: 0,
    costTracker: tracker,
    ...(bindingIdentity ? { bindingIdentity } : {}),
    ...(overrides.globalCapUsd !== undefined ? { globalCapUsd: overrides.globalCapUsd } : {}),
    ...(overrides.globalBudget ? { globalBudget: overrides.globalBudget } : {}),
  });
}

Deno.test("[budget] spend on service A counts against a call on service B under the global cap", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    await tracker.trackGeneration(
      "openai-chat",
      "a-model",
      {
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        costUsd: 0.06,
      },
      undefined,
      undefined,
      { service: "alpha", transport: "cloud" },
    );
    await tracker.flush();

    const beta = makeProvider(tracker, { service: "beta", globalCapUsd: 0.07 });
    await assertRejects(
      () => beta.generate("prompt", fixtureOptions()),
      RateLimiterError,
      "budget exceeded",
    );
  });
});

Deno.test("[budget] a per-service daily_cost_cap_usd blocks that service while others continue", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    const alpha = makeProvider(tracker, { service: "alpha", dailyCostCapUsd: 0.06 });
    const beta = makeProvider(tracker, { service: "beta", dailyCostCapUsd: 0.06 });
    const result = await alpha.generate("prompt", fixtureOptions());
    assertEquals(result.content, "ok");
    // alpha's persisted spend (0.05) plus a second 0.05 exceeds its 0.06 cap. Beta stays
    // unaffected because per-service caps are independent.
    await assertRejects(
      () => alpha.generate("prompt", fixtureOptions()),
      RateLimiterError,
      "budget exceeded",
    );
    const betaResult = await beta.generate("prompt", fixtureOptions());
    assertEquals(betaResult.content, "ok");
  });
});

Deno.test("[budget] unpriced local usage does not block a priced cloud call", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    await tracker.recordUnpricedGeneration("ollama", "unpriced-local", {
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
    });
    const cloud = makeProvider(tracker, { service: "alpha", globalCapUsd: 0.1 });
    const result = await cloud.generate("prompt", fixtureOptions());
    assertEquals(result.content, "ok");
  });
});

Deno.test("[budget] priced local usage does not consume cloud budget; unknown-price cloud fails closed", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    await tracker.trackGeneration(
      "ollama",
      "local-model",
      {
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        costUsd: 0.9,
      },
      undefined,
      undefined,
      { service: "local-svc", transport: "local" },
    );
    await tracker.flush();

    const cloud = makeProvider(tracker, { service: "alpha", globalCapUsd: 0.1 });
    const result = await cloud.generate("prompt", fixtureOptions());
    assertEquals(result.content, "ok", "priced local spend must not consume the cloud global cap");

    const unknownPrice = makeProvider(tracker, {
      service: "gamma",
      globalCapUsd: 0.1,
    }, {
      ...baseInner(),
      estimateCallCost: () => Promise.resolve(Number.NaN),
    });
    await assertRejects(
      () => unknownPrice.generate("prompt", fixtureOptions()),
      ProviderCallPolicyError,
      "pricing_unavailable",
    );
  });
});

Deno.test("[budget] with an operator binding layer present, the boot provider also counts against the global cap", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    const boot = makeProvider(tracker, {
      globalCapUsd: 0.06,
      maxCostPerDay: 0.06,
      globalBudget: () => Promise.resolve(true),
    });
    const first = await boot.generate("prompt", fixtureOptions());
    assertEquals(first.content, "ok");
    await assertRejects(
      () => boot.generate("prompt", fixtureOptions()),
      RateLimiterError,
      "budget exceeded",
    );
  });
});

Deno.test("[budget] a per-run-only overlay activates the global cap for that run; binding-mode removal restores per-provider behavior", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    // The overlay predicate is true on the first (per-run-only) call and false afterwards.
    let active = true;
    const boot = makeProvider(tracker, {
      globalCapUsd: 0.06,
      maxCostPerDay: 0.06,
      globalBudget: () => Promise.resolve(active),
    });
    const first = await boot.generate("prompt", fixtureOptions());
    assertEquals(first.content, "ok");
    active = false;
    // Now the boot provider is outside the binding mode. The legacy per-provider path
    // rejects a second 0.05 call under the 0.06 cap (prior behavior restored).
    await assertRejects(
      () => boot.generate("prompt", fixtureOptions()),
      RateLimiterError,
      "Cost limit exceeded",
    );
  });
});

Deno.test("[budget] two calls at the remaining headroom admit at most one; a failed call releases its reservation", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    const inner: IModelProvider = {
      ...baseInner(),
      generate: () =>
        Promise.resolve({
          content: "ok",
          usage: { promptTokens: 5000, completionTokens: 5000, totalTokens: 10000 },
          model: "bound",
          provider: "openai-chat-bound",
          costStatus: "estimated" as const,
          cost_usd: 0.05,
        }),
    };
    const cap = makeProvider(tracker, { service: "alpha", globalCapUsd: 0.09 }, inner);
    const first = await cap.generate("prompt", fixtureOptions());
    assertEquals(first.content, "ok");
    // The first call persisted 0.05. A second of 0.05 totals 0.10 which exceeds 0.09.
    await assertRejects(
      () => cap.generate("prompt", fixtureOptions()),
      RateLimiterError,
      "budget exceeded",
    );

    // A failing call releases its reservation and frees headroom for a later admission.
    let calls = 0;
    const failOnceInner: IModelProvider = {
      ...baseInner(),
      generate: () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("boom"));
        return Promise.resolve({
          content: "ok",
          usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
          model: "bound",
          provider: "openai-chat-bound",
          costStatus: "estimated" as const,
          cost_usd: 0.01,
        });
      },
    };
    const retry = makeProvider(tracker, { service: "gamma", globalCapUsd: 0.12 }, failOnceInner);
    await assertRejects(() => retry.generate("prompt", fixtureOptions()), Error, "boom");
    // The failed call released its reservation: alpha's 0.05 stays on the ledger and a 0.05
    // estimate (actual 0.01) fits under the 0.12 global cap.
    const later = await retry.generate("prompt", fixtureOptions());
    assertEquals(later.content, "ok");
  });
});

Deno.test("[regression] without an operator binding layer, the per-provider cap behavior is preserved", async () => {
  registerCompatible();
  await withBudgetTracker(async (tracker) => {
    // No bindingIdentity, no globalBudget, no globalCapUsd → the legacy per-provider cap
    // path stays. The in-memory costThisDay check rejects a second 0.05 call under 0.06.
    const provider = makeProvider(tracker, { maxCostPerDay: 0.06 });
    const first = await provider.generate("prompt", fixtureOptions());
    assertEquals(first.content, "ok");
    await assertRejects(
      () => provider.generate("prompt", fixtureOptions()),
      RateLimiterError,
      "Cost limit exceeded",
    );
  });
});
