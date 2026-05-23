/**
 * @module AIProviderRegistryBootstrapTest
 * @path packages/ai/tests/provider_registry_bootstrap_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies that the package-local registry initializer only registers providers owned by @exaix/ai.
 */

import { assertEquals, assertExists } from "@std/assert";
import { initializeRegistry } from "../src/provider_factory.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";

Deno.test("initializeRegistry registers only mock provider ownership inside @exaix/ai", () => {
  ProviderRegistry.clear();

  initializeRegistry();

  const supported = ProviderRegistry.getSupportedProviders();

  assertEquals(supported.includes("mock"), true);
  assertEquals(supported.includes("anthropic"), false);
  assertEquals(supported.includes("openai"), false);
  assertEquals(supported.includes("google"), false);
  assertEquals(supported.includes("ollama"), false);
  assertExists(ProviderRegistry.getFactory("mock"));
});
