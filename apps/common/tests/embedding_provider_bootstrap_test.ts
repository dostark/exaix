/**
 * @module EmbeddingProviderBootstrapTest
 * @path apps/common/tests/embedding_provider_bootstrap_test.ts
 * @description Verifies createMemoryEmbeddingProvider routes config.memory.embedding to the
 * correct concrete IEmbeddingProvider, so the daemon and exactl composition roots share one
 * selection path instead of two that can drift apart.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { createMockConfig } from "@exaix/testing";
import { ProviderType } from "@exaix/core";
import { createMemoryEmbeddingProvider } from "../embedding_provider_bootstrap.ts";

Deno.test("[createMemoryEmbeddingProvider] defaults to Ollama when memory.embedding is unset", () => {
  const config = createMockConfig("/tmp/embedding-bootstrap-test");
  const provider = createMemoryEmbeddingProvider(config);
  assertEquals(provider.providerId, "ollama");
});

Deno.test("[createMemoryEmbeddingProvider] routes provider: openai to the OpenAI branch", () => {
  const base = createMockConfig("/tmp/embedding-bootstrap-test");
  const config = {
    ...base,
    memory: {
      ...base.memory,
      embedding: { provider: ProviderType.OPENAI, model: "text-embedding-3-small", dimension: 1536 },
    },
  };
  assertThrows(
    () => createMemoryEmbeddingProvider(config),
    Error,
    "OpenAI embedding client is not yet implemented",
  );
});
