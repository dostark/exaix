/**
 * @module ModelResolverFixedClientTest
 * @path packages/ai/tests/model_resolver_fixed_client_test.ts
 * @description A caller whose client cannot change reports that client as the resolved model.
 *   The intent still drives the call options, and model.resolved names the client that runs.
 * @architectural-layer Test
 * @related-files [packages/ai/src/model_resolver.ts, packages/schemas/src/model_intent.ts]
 */
import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";

const FIXED_CLIENT = { provider: "openai-chat", model: "deepseek-v4-pro" };

function registerProvider(name: string, supportsThinking: boolean): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: ["general"],
    supportsThinking,
  });
}

function setup() {
  ProviderRegistry.clear();
  registerProvider("anthropic", true);
  registerProvider("openai-chat", true);
  const logger = createMockEventLogger();
  const resolver = new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger,
  );
  return { logger, resolver };
}

Deno.test("[ModelResolver] a size intent with a fixed client resolves to that client", async () => {
  const { logger, resolver } = setup();
  try {
    const resolved = await resolver.resolve({
      model_size: "M",
      thinking: true,
      effort: "high",
      fixed_client: FIXED_CLIENT,
    });

    assertEquals({ provider: resolved.provider, model: resolved.model }, FIXED_CLIENT);
    assertEquals(resolved.options, { thinking: true, effort: "high", max_tokens: 8192 });
    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length, 1);
    assertEquals(events[0].target, FIXED_CLIENT.model);
    assertEquals(events[0].payload?.reason, "fixed_client");
    assertEquals(events[0].payload?.candidate_providers, [FIXED_CLIENT.provider]);
    assertEquals((events[0].payload?.intent as { model_size?: string }).model_size, "M");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[ModelResolver] an explicit model cannot move a fixed client to another provider", async () => {
  const { logger, resolver } = setup();
  try {
    const resolved = await resolver.resolve({
      model: "anthropic:claude-haiku-4-5",
      fixed_client: FIXED_CLIENT,
    });

    assertEquals({ provider: resolved.provider, model: resolved.model }, FIXED_CLIENT);
    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events[0].payload?.reason, "fixed_client");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[ModelResolver] without a fixed client the intent still picks from the registry", async () => {
  const { logger, resolver } = setup();
  try {
    await resolver.resolve({ thinking: true });

    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length, 1);
    assertEquals(events[0].payload?.reason, "preset_default");
  } finally {
    ProviderRegistry.clear();
  }
});
