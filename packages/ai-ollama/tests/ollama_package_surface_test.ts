/**
 * @module OllamaPackageSurfaceTest
 * @path packages/ai-ollama/tests/ollama_package_surface_test.ts
 * @description Verifies the public @exaix/ai-ollama package surface.
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import {
  DEFAULT_OLLAMA_MODEL,
  LlamaProvider,
  LlamaProviderFactory,
  OllamaEmbeddingClient,
  OllamaProvider,
  OllamaProviderFactory,
} from "../mod.ts";

Deno.test("@exaix/ai-ollama exports providers, factories, and embedding client", () => {
  assertExists(OllamaProvider);
  assertExists(LlamaProvider);
  assertExists(OllamaEmbeddingClient);
  assertExists(OllamaProviderFactory);
  assertExists(LlamaProviderFactory);
});

Deno.test("OllamaProvider constructs with defaults from package surface", () => {
  const provider = new OllamaProvider();

  assertEquals(typeof provider.id, "string");
  assertEquals(provider.id, `ollama-${DEFAULT_OLLAMA_MODEL}`);
});

Deno.test("LlamaProvider accepts supported models from package surface", () => {
  const provider = new LlamaProvider({ model: "llama3.2:latest" });

  assertEquals(provider.id, "llama-llama3.2:latest");
});

Deno.test("OllamaEmbeddingClient accepts localhost baseUrl", () => {
  const client = new OllamaEmbeddingClient({ baseUrl: "http://localhost:11434" });

  assertEquals(client.providerId, "ollama");
  assertEquals(client.dimension, 768);
});

Deno.test("OllamaEmbeddingClient rejects non-localhost baseUrl", () => {
  assertThrows(
    () => new OllamaEmbeddingClient({ baseUrl: "https://example.com" }),
    Error,
    "localhost only",
  );
});
