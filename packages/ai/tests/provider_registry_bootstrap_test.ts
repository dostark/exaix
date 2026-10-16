/**
 * @module AIProviderRegistryBootstrapTest
 * @path packages/ai/tests/provider_registry_bootstrap_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies that the package-local registry initializer only registers providers owned by @exaix/ai.
 */

import { assertArrayIncludes, assertExists, assertFalse } from "@std/assert";
import { initializeRegistry } from "../src/provider_factory.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";

Deno.test("initializeRegistry registers only mock provider ownership inside @exaix/ai", () => {
  ProviderRegistry.clear();

  initializeRegistry();

  const supported = ProviderRegistry.getSupportedProviders();

  assertArrayIncludes(supported, ["mock"]);
  assertFalse(supported.includes("anthropic"));
  assertFalse(supported.includes("openai"));
  assertFalse(supported.includes("google"));
  assertFalse(supported.includes("ollama"));
  assertExists(ProviderRegistry.getFactory("mock"));
});
