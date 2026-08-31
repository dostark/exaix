/**
 * @module EmbeddingErrorsTest
 * @path packages/ai/tests/embeddings/embedding_errors_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Tests for the EmbeddingError class and error codes used
 * across the embedding provider layer.
 */

import { assertEquals, assertInstanceOf } from "@std/assert";
import { EmbeddingError } from "../../src/embeddings/embedding_errors.ts";

// EmbeddingError Tests

Deno.test("EmbeddingError: extends Error with correct code", () => {
  const err = new EmbeddingError("MODEL_NOT_FOUND", "Model nomic-embed-text not found");

  assertInstanceOf(err, Error);
  assertEquals(err.code, "MODEL_NOT_FOUND");
  assertEquals(err.message, "Model nomic-embed-text not found");
});

Deno.test("EmbeddingError: PROVIDER_UNAVAILABLE code", () => {
  const err = new EmbeddingError("PROVIDER_UNAVAILABLE", "Ollama is not running");
  assertEquals(err.code, "PROVIDER_UNAVAILABLE");
  assertEquals(err.message, "Ollama is not running");
});

Deno.test("EmbeddingError: EMBEDDING_FAILED code", () => {
  const err = new EmbeddingError("EMBEDDING_FAILED", "API returned 500");
  assertEquals(err.code, "EMBEDDING_FAILED");
});

Deno.test("EmbeddingError: TIMEOUT code", () => {
  const err = new EmbeddingError("TIMEOUT", "Request timed out after 30s");
  assertEquals(err.code, "TIMEOUT");
});

Deno.test("EmbeddingError: UNKNOWN_PROVIDER code", () => {
  const err = new EmbeddingError("UNKNOWN_PROVIDER", "Provider 'foo' not recognized");
  assertEquals(err.code, "UNKNOWN_PROVIDER");
});

Deno.test("EmbeddingError: name property is EmbeddingError", () => {
  const err = new EmbeddingError("MODEL_NOT_FOUND", "test");
  assertEquals(err.name, "EmbeddingError");
});
