/**
 * @module AnthropicPackageSurfaceTest
 * @path packages/ai-anthropic/tests/anthropic_package_surface_test.ts
 * @description Verifies the public @exaix/ai-anthropic package surface.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AnthropicProvider, AnthropicProviderFactory, DEFAULT_ANTHROPIC_MODEL } from "../mod.ts";

Deno.test("@exaix/ai-anthropic exports provider and factory", () => {
  assertExists(AnthropicProvider);
  assertExists(AnthropicProviderFactory);
});

Deno.test("AnthropicProvider constructs with defaults from package surface", () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });

  assertEquals(typeof provider.id, "string");
  assertEquals(provider.id, `anthropic-${DEFAULT_ANTHROPIC_MODEL}`);
});
