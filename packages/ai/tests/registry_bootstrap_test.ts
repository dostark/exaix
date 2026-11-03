/**
 * @module RootRegistryBootstrapTest
 * @path packages/ai/tests/registry_bootstrap_test.ts
 * @description Verifies that the root composition bootstrap registers Solo-tier concrete AI providers (including OpenRouter, per edition decision D5b) and excludes Team-only providers (Vertex AI).
 */

import { assertEquals, assertExists, assertFalse } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";

Deno.test("bootstrapProviderRegistry registers Solo-tier providers (incl. OpenRouter) and excludes Team-only providers", () => {
  ProviderRegistry.clear();

  bootstrapProviderRegistry();

  const supported = ProviderRegistry.getSupportedProviders();
  const supportedIncludesMock: boolean = supported.includes("mock");
  assertEquals(supportedIncludesMock, true, "supported should include 'mock'");
  const supportedIncludesAnthropic: boolean = supported.includes("anthropic");
  assertEquals(supportedIncludesAnthropic, true, "supported should include 'anthropic'");
  const supportedIncludesOpenai: boolean = supported.includes("openai");
  assertEquals(supportedIncludesOpenai, true, "supported should include 'openai'");
  const supportedIncludesGoogle: boolean = supported.includes("google");
  assertEquals(supportedIncludesGoogle, true, "supported should include 'google'");
  assertFalse(supported.includes("vertex-ai"));
  // OpenRouter ships in Solo (all editions) — D5b/D-providers.
  const supportedIncludesOpenrouter: boolean = supported.includes("openrouter");
  assertEquals(supportedIncludesOpenrouter, true, "supported should include 'openrouter'");
  const supportedIncludesOllama: boolean = supported.includes("ollama");
  assertEquals(supportedIncludesOllama, true, "supported should include 'ollama'");
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

Deno.test("[google-native] Google declares native conversation and whole-round replay", () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();

  const google = ProviderRegistry.getProviderMetadata("google");
  assertEquals(google?.supportsNativeConversation, true);
  assertEquals(google?.supportsNativeRoundReplay, true);
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
