/**
 * @module OpenAIPackageSurfaceTest
 * @path packages/ai-openai/tests/openai_package_surface_test.ts
 * @description Verifies the public @exaix/ai-openai package surface.
 */

import { assertEquals, assertExists } from "@std/assert";
import { DEFAULT_OPENAI_MODEL, OpenAIEmbeddingClient, OpenAIProvider, OpenAIProviderFactory } from "../mod.ts";

Deno.test("@exaix/ai-openai exports provider, factory, and embedding client", () => {
  assertExists(OpenAIProvider);
  assertExists(OpenAIProviderFactory);
  assertExists(OpenAIEmbeddingClient);
});

Deno.test("OpenAIProvider constructs with defaults from package surface", () => {
  const provider = new OpenAIProvider({ apiKey: "test-key" });

  assertEquals(typeof provider.id, "string");
  assertEquals(provider.id, `openai-${DEFAULT_OPENAI_MODEL}`);
});

Deno.test("OpenAIEmbeddingClient constructs with required apiKey", () => {
  const client = new OpenAIEmbeddingClient({ apiKey: "test-key" });

  assertEquals(client.providerId, "openai");
  assertEquals(client.dimension, 1536);
});
