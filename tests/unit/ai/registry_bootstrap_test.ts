/**
 * @module RootRegistryBootstrapTest
 * @path tests/unit/ai/registry_bootstrap_test.ts
 * @description Verifies that the root composition bootstrap registers extracted concrete AI providers.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";

Deno.test("bootstrapProviderRegistry registers root concrete providers and is idempotent", () => {
  ProviderRegistry.clear();

  bootstrapProviderRegistry();

  const supported = ProviderRegistry.getSupportedProviders();
  assertEquals(supported.includes("mock"), true);
  assertEquals(supported.includes("anthropic"), true);
  assertEquals(supported.includes("openai"), true);
  assertEquals(supported.includes("google"), true);
  assertEquals(supported.includes("ollama"), true);
  assertExists(ProviderRegistry.getFactory("mock"));
  assertExists(ProviderRegistry.getFactory("anthropic"));
  assertExists(ProviderRegistry.getFactory("openai"));
  assertExists(ProviderRegistry.getFactory("google"));
  assertExists(ProviderRegistry.getFactory("ollama"));

  bootstrapProviderRegistry();

  assertEquals(ProviderRegistry.getSupportedProviders(), supported);
});
