/**
 * @module EmbeddingProviderFactoryTest
 * @path packages/ai/tests/embeddings/embedding_provider_factory_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Tests for the embedding provider factory that creates
 * IEmbeddingProvider instances from discriminated config.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { createEmbeddingProvider } from "../../src/embeddings/embedding_provider_factory.ts";
import { EmbeddingError } from "../../src/embeddings/embedding_errors.ts";

// ============================================================================
// Factory Tests
// ============================================================================

Deno.test("EmbeddingProviderFactory: returns Ollama provider for ollama config", () => {
  const provider = createEmbeddingProvider({
    provider: "ollama",
    model: "nomic-embed-text",
    baseUrl: "http://127.0.0.1:11434",
    chunkSize: 1000,
  });

  assertEquals(provider.providerId, "ollama");
});

Deno.test("EmbeddingProviderFactory: returns OpenAI provider for openai config", () => {
  const provider = createEmbeddingProvider({
    provider: "openai",
    model: "text-embedding-3-small",
    apiKey: "sk-test-key",
    baseUrl: "https://api.openai.com/v1",
    chunkSize: 8000,
  });

  assertEquals(provider.providerId, "openai");
});

Deno.test("EmbeddingProviderFactory: returns llama.cpp provider for llamacpp config", () => {
  const provider = createEmbeddingProvider({
    provider: "llamacpp",
    model: "nomic-embed-text",
    baseUrl: "http://127.0.0.1:8080",
    chunkSize: 1000,
  });

  assertEquals(provider.providerId, "llamacpp");
});

Deno.test("EmbeddingProviderFactory: throws on unknown provider", () => {
  assertThrows(
    () =>
      createEmbeddingProvider({
        provider: "unknown" as never,
        model: "some-model",
        baseUrl: "http://localhost:9999",
        chunkSize: 1000,
      }),
    EmbeddingError,
    "Unknown embedding provider",
  );
});

Deno.test("EmbeddingProviderFactory: Ollama provider rejects non-localhost baseUrl", () => {
  assertThrows(
    () =>
      createEmbeddingProvider({
        provider: "ollama",
        model: "nomic-embed-text",
        baseUrl: "https://external-server.com",
        chunkSize: 1000,
      }),
    EmbeddingError,
    "localhost",
  );
});

Deno.test("EmbeddingProviderFactory: OpenAI provider rejects empty apiKey", () => {
  assertThrows(
    () =>
      createEmbeddingProvider({
        provider: "openai",
        model: "text-embedding-3-small",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        chunkSize: 8000,
      }),
    EmbeddingError,
    "API key",
  );
});
