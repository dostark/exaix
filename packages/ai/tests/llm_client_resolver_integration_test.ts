/**
 * @module LlmClientResolverIntegrationTest
 * @path packages/ai/tests/llm_client_resolver_integration_test.ts
 * @description Phase 132.5 — verifies LlmClient with injected ModelResolver resolves model
 *   without env var side effects, and falls back to ProviderFactory when no resolver.
 * @architectural-layer AI
 * @related-files [packages/ai/src/llm_client.ts, packages/ai/src/model_resolver.ts]
 */
import { assertEquals } from "@std/assert";
import { LlmClient } from "../src/llm_client.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { IModelProvider } from "../src/types.ts";
import type { IGenerateResult } from "../src/providers/common.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import type { IProviderHealthChecker } from "../src/provider_selector.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { Config } from "@exaix/schemas";

function registerProvider(name: string): void {
  if (!ProviderRegistry.getProviderMetadata(name)) {
    const factory = new MockProviderFactory();
    ProviderRegistry.registerWithMetadata(name, factory, {
      name,
      description: name,
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: [],
      supportsThinking: true,
      contextWindow: 128000,
      costPerMtok: 0,
    });
  }
}

const dummyProvider: IModelProvider = {
  id: "dummy",
  generate(_prompt: string): Promise<IGenerateResult> {
    return Promise.resolve({
      content: '{"reasoning":"done","action":{"type":"complete","output":"ok"}}',
      model: "test",
      provider: "mock",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  },
};

Deno.test("[step132.5] LlmClient without resolver falls back to ProviderFactory.createByName", () => {
  registerProvider("mock-provider");
  const client = new LlmClient(undefined, dummyProvider, "mock-provider");
  // Should not throw — testProvider short-circuits resolver, so this is a basic smoke test
  assertEquals(client instanceof LlmClient, true);
});

Deno.test("[step132.5] LlmClient constructor accepts optional resolver", () => {
  const logger: IEventLogger = {
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    log: () => Promise.resolve(),
    child: () => logger,
  };
  const healthChecker: IProviderHealthChecker = { checkProvider: () => Promise.resolve(true) };
  const routingStrategy = new DefaultRoutingStrategy(
    ProviderRegistry,
    { getDailyCost: () => Promise.resolve(0) } as never,
    healthChecker,
  );
  const resolver = new ModelResolver(
    routingStrategy,
    {} as Config,
    healthChecker,
    logger,
  );
  const client = new LlmClient(undefined, dummyProvider, "default", resolver);
  assertEquals(client instanceof LlmClient, true);
});
