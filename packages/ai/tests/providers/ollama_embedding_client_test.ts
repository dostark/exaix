/**
 * @module OllamaEmbeddingClientTest
 * @path packages/ai/tests/providers/ollama_embedding_client_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Tests for the Ollama embedding client that calls /api/embed
 * with localhost-only SSRF validation, response validation, and batching.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { OllamaEmbeddingClient } from "@exaix/ai-ollama";
import { EmbeddingError } from "../../src/embeddings/embedding_errors.ts";

// ============================================================================
// Constructor Validation Tests
// ============================================================================

Deno.test("OllamaEmbeddingClient: rejects non-localhost baseUrl", () => {
  try {
    new OllamaEmbeddingClient({ baseUrl: "https://external-server.com" });
    throw new Error("Should have thrown");
  } catch (err) {
    if (err instanceof EmbeddingError) {
      assertEquals(err.code, "INVALID_CONFIG");
    } else {
      throw err;
    }
  }
});

Deno.test("OllamaEmbeddingClient: accepts localhost variants", () => {
  // Should not throw
  new OllamaEmbeddingClient({ baseUrl: "http://localhost:11434" });
  new OllamaEmbeddingClient({ baseUrl: "http://127.0.0.1:11434" });
  new OllamaEmbeddingClient({ baseUrl: "http://[::1]:11434" });
});

// ============================================================================
// Embedding Tests (with mock fetch)
// ============================================================================

const originalFetch = globalThis.fetch;

Deno.test("OllamaEmbeddingClient: embed returns number[][] for valid response", async () => {
  const mockEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ embeddings: mockEmbeddings })));

  try {
    const client = new OllamaEmbeddingClient();
    const result = await client.embed(["hello", "world"]);

    assertEquals(result.length, 2);
    assertEquals(result[0], [0.1, 0.2, 0.3]);
    assertEquals(result[1], [0.4, 0.5, 0.6]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaEmbeddingClient: embed throws on model not found", async () => {
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ error: "model 'missing-model' not found" }), { status: 404 }));

  try {
    const client = new OllamaEmbeddingClient();
    await assertRejects(
      () => client.embed(["test"]),
      EmbeddingError,
      "not found",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaEmbeddingClient: embed throws on non-conforming response", async () => {
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ wrong_field: true })));

  try {
    const client = new OllamaEmbeddingClient();
    await assertRejects(
      () => client.embed(["test"]),
      EmbeddingError,
      "missing embeddings",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaEmbeddingClient: embed throws on invalid embeddings entry", async () => {
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ embeddings: [[0.1], "not-a-number"] })));

  try {
    const client = new OllamaEmbeddingClient();
    await assertRejects(
      () => client.embed(["test"]),
      EmbeddingError,
      "not a number array",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaEmbeddingClient: embed returns empty array for empty input", async () => {
  const client = new OllamaEmbeddingClient();
  const result = await client.embed([]);
  assertEquals(result.length, 0);
});

Deno.test("OllamaEmbeddingClient: providerId is 'ollama'", () => {
  const client = new OllamaEmbeddingClient();
  assertEquals(client.providerId, "ollama");
});

Deno.test("OllamaEmbeddingClient: dimension is 768 for nomic-embed-text", () => {
  const client = new OllamaEmbeddingClient();
  assertEquals(client.dimension, 768);
});
