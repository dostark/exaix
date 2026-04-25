/**
 * @module LlamaFactoryTest
 * @path tests/ai/llama_factory_test.ts
 * @description Verifies the Llama (local) provider factory, ensuring correct
 * wiring of base URLs and model identifiers for local LLM execution.
 */

import { assertEquals } from "@std/assert";
import { ProviderType } from "@exaix/core";
import { DEFAULT_OLLAMA_ENDPOINT } from "@exaix/core";
import { LlamaProviderFactory } from "../../src/ai/factories/llama_factory.ts";
import type { LlamaProvider } from "../../src/ai/providers/llama_provider.ts";

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
