/**
 * @module LlamaFactoryTest
 * @path packages/ai/tests/llama_factory_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies the Llama (local) provider factory, ensuring correct
 * wiring of base URLs and model identifiers for local LLM execution.
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_OLLAMA_ENDPOINT, type LlamaProvider, LlamaProviderFactory } from "@exaix/ai-ollama";
import { ProviderType } from "@exaix/core";

Deno.test("LlamaProviderFactory.create wires model + baseUrl into LlamaProvider", async () => {
  const factory = new LlamaProviderFactory();

  const provider = await factory.create({
    provider: ProviderType.OLLAMA,
    model: "llama3.2:test",
    baseUrl: "http://example.test/api",
    timeoutMs: 1000,
  });

  assertEquals(provider.id, "llama-llama3.2:test");
  const llama = provider as LlamaProvider;
  assertEquals(llama.model, "llama3.2:test");
  assertEquals(llama.endpoint, "http://example.test/api");
});

Deno.test("LlamaProviderFactory.create uses default endpoint when baseUrl is missing", async () => {
  const factory = new LlamaProviderFactory();

  const provider = await factory.create({
    provider: ProviderType.OLLAMA,
    model: "llama3.2:test",
    timeoutMs: 1000,
  });

  const llama = provider as LlamaProvider;
  assertEquals(llama.endpoint, DEFAULT_OLLAMA_ENDPOINT);
});
