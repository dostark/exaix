/**
 * @module ResolveIdentityModelTest
 * @path packages/ai/tests/resolve_identity_model_test.ts
 * @description Phase 131 Step 6 (GAP-3) — the identity model resolver. Verifies
 *   resolveIdentityModel maps declarative model preferences onto a concrete
 *   {provider, model} pair (not just a provider name): explicit `model` wins,
 *   else preferences select a provider via ProviderSelector and a concrete model
 *   via getDefaultModels, and unsupported thinking/effort hints degrade
 *   gracefully without throwing.
 * @architectural-layer AI
 * @dependencies [@std/assert, @exaix/core, @exaix/testing]
 * @related-files [packages/ai/src/resolve_identity_model.ts, packages/ai/src/provider_selector.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ProviderSelector } from "../src/provider_selector.ts";
import { resolveIdentityModel } from "../src/resolve_identity_model.ts";

function makeSelector(): ProviderSelector {
  return new ProviderSelector(ProviderRegistry, createStubCostTracker(), createStubHealthChecker());
}

function registerOne(name: string, tier: PricingTier): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: tier,
    strengths: ["general"],
  });
}

Deno.test("[step6][GAP-3] explicit model preference wins and returns a concrete {provider, model}", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerOne("anthropic", PricingTier.MEDIUM);
    const got = await resolveIdentityModel({ model: "anthropic:claude-sonnet-5" }, makeSelector());
    assertEquals(got.provider, "anthropic");
    assertEquals(got.model, "claude-sonnet-5");
  } finally {
    await cleanup();
  }
});

Deno.test("[step6][GAP-3] preferences resolve to a concrete model (not just a provider name)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerOne("anthropic", PricingTier.HIGH);
    const got = await resolveIdentityModel({ model_size: "L" }, makeSelector());
    assertEquals(got.provider, "anthropic");
    // The model must be a real concrete id from getDefaultModels, never empty or the bare provider.
    assert(got.model.length > 0, "model must be concrete");
    assert(got.model !== "anthropic", "must not return the bare provider name as the model");
  } finally {
    await cleanup();
  }
});

Deno.test("[step6] unsupported thinking/effort hints degrade gracefully (no throw)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerOne("anthropic", PricingTier.HIGH);
    const got = await resolveIdentityModel(
      { model_size: "XL", thinking: true, effort: "high" },
      makeSelector(),
    );
    assertEquals(got.provider, "anthropic");
    assert(got.model.length > 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[step6] preferred_provider hint maps to requiredCapabilities without throwing", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerOne("openai", PricingTier.MEDIUM);
    const got = await resolveIdentityModel({ preferred_provider: "openai", model_size: "M" }, makeSelector());
    assertEquals(got.provider, "openai");
    assert(got.model.length > 0);
  } finally {
    await cleanup();
  }
});
