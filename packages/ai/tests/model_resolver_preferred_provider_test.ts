/**
 * @module ModelResolverPreferredProviderTest
 * @path packages/ai/tests/model_resolver_preferred_provider_test.ts
 * @description Phase 132 GAP-5 remediation (132.22) — the `preferred_provider` soft
 *   hint must bias ModelResolver's selection toward the named provider ("narrow the
 *   candidate pool"), while still falling through when the hint cannot satisfy the
 *   intent and preserving the thinking constraint.
 * @architectural-layer AI
 * @dependencies [@std/assert, @exaix/testing]
 * @related-files [packages/ai/src/model_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";

function registerProvider(
  name: string,
  opts: { supportsThinking?: boolean; costPerMtok?: number; contextWindow?: number } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    supportsThinking: opts.supportsThinking,
    costPerMtok: opts.costPerMtok,
    contextWindow: opts.contextWindow,
  });
}

function makeResolver(logger?: ReturnType<typeof createMockEventLogger>): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
  );
}

Deno.test("[132.22] preferred_provider selects the named provider over the default-routed one", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("default-routed", { costPerMtok: 1 });
    registerProvider("preferred", { costPerMtok: 100 });

    const resolver = makeResolver();
    const result = await resolver.resolve({ preferred_provider: "preferred" });

    assertEquals(result.provider, "preferred");
  } finally {
    await cleanup();
  }
});

Deno.test("[132.22] preferred_provider that is not eligible falls through to normal selection", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("known-provider");

    const resolver = makeResolver();
    const result = await resolver.resolve({ preferred_provider: "unknown-provider" });

    assertEquals(result.provider, "known-provider");
  } finally {
    await cleanup();
  }
});

Deno.test("[132.22] thinking:true with an incapable preferred provider still constrains to a thinking provider", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("preferred-no-thinking", { supportsThinking: false });
    registerProvider("thinking-provider", { supportsThinking: true });

    const resolver = makeResolver();
    const result = await resolver.resolve({ preferred_provider: "preferred-no-thinking", thinking: true });

    assertEquals(result.provider, "thinking-provider");
  } finally {
    await cleanup();
  }
});
