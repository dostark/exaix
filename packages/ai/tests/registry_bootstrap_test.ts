/**
 * @module RootRegistryBootstrapTest
 * @path packages/ai/tests/registry_bootstrap_test.ts
 * @description Verifies that the root composition bootstrap registers Solo-tier concrete AI providers and excludes Team-only providers.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";

Deno.test("bootstrapProviderRegistry registers Solo-tier providers and excludes Team-only providers", () => {
  ProviderRegistry.clear();

  bootstrapProviderRegistry();

  const supported = ProviderRegistry.getSupportedProviders();
  assertEquals(supported.includes("mock"), true);
  assertEquals(supported.includes("anthropic"), true);
  assertEquals(supported.includes("openai"), true);
  assertEquals(supported.includes("google"), true);
  assertEquals(supported.includes("vertex-ai"), false);
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
