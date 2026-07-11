/**
 * @module RootRegistryBootstrapTest
 * @path packages/ai/tests/registry_bootstrap_test.ts
 * @description Verifies that the root composition bootstrap registers Solo-tier concrete AI providers (including OpenRouter, per edition decision D5b) and excludes Team-only providers (Vertex AI).
 */

import { assertEquals, assertExists } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";

Deno.test("bootstrapProviderRegistry registers Solo-tier providers (incl. OpenRouter) and excludes Team-only providers", () => {
  ProviderRegistry.clear();

  bootstrapProviderRegistry();

  const supported = ProviderRegistry.getSupportedProviders();
  assertEquals(supported.includes("mock"), true);
  assertEquals(supported.includes("anthropic"), true);
  assertEquals(supported.includes("openai"), true);
  assertEquals(supported.includes("google"), true);
  assertEquals(supported.includes("vertex-ai"), false);
  // OpenRouter ships in Solo (all editions) — D5b/D-providers.
  assertEquals(supported.includes("openrouter"), true);
  assertEquals(supported.includes("ollama"), true);
  assertExists(ProviderRegistry.getFactory("mock"));
  assertExists(ProviderRegistry.getFactory("anthropic"));
  assertExists(ProviderRegistry.getFactory("openai"));
  assertExists(ProviderRegistry.getFactory("google"));
  assertEquals(ProviderRegistry.getFactory("vertex-ai"), undefined);
  assertExists(ProviderRegistry.getFactory("openrouter"));
  assertExists(ProviderRegistry.getFactory("ollama"));

  bootstrapProviderRegistry();

  assertEquals(ProviderRegistry.getSupportedProviders(), supported);
});

Deno.test("[step4] isAggregator: openrouter true; anthropic/openai/google/ollama absent (§5.7.2)", () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();

  assertEquals(ProviderRegistry.getProviderMetadata("openrouter")?.isAggregator, true);
  assertEquals(ProviderRegistry.getProviderMetadata("anthropic")?.isAggregator, undefined);
  assertEquals(ProviderRegistry.getProviderMetadata("openai")?.isAggregator, undefined);
  assertEquals(ProviderRegistry.getProviderMetadata("google")?.isAggregator, undefined);
  assertEquals(ProviderRegistry.getProviderMetadata("ollama")?.isAggregator, undefined);

  ProviderRegistry.clear();
});
