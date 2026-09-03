/**
 * @module MemoryEmbeddingTest
 * @path packages/memory/tests/embedding/memory_embedding_test.ts
 * @related-files []
 * @architectural-layer Memory
 * @description Verifies the core cosine similarity algorithm for RAG-based search, validating
 * correct comparisons for identical, orthogonal, and opposing embedding vectors.
 */

import { assertAlmostEquals, assertEquals, assertExists, assertGreaterOrEqual } from "@std/assert";
import {
  ConfidenceAssessmentLevel,
  EvaluationCategory,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "@exaix/core";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { cosineSimilarity, generateMockEmbedding, MemoryEmbeddingService } from "@exaix/memory";
import { initTestDbService } from "@exaix/testing";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { MemoryStatus } from "@exaix/core/status";
import { getMemoryIndexDir } from "@exaix/testing";

// Test Fixtures

const testLearning: ILearning = {
  id: "bbbbbbbb-2222-4000-8000-000000000001",
  created_at: new Date().toISOString(),
  source: MemoryBankSource.USER,
  scope: MemoryScope.GLOBAL,
  title: "Test learning for embedding",
  description: "This is a test learning about error handling best practices in TypeScript",
  category: LearningCategory.PATTERN,
  tags: ["error-handling", "typescript"],
  confidence: ConfidenceAssessmentLevel.HIGH,
  status: MemoryStatus.APPROVED,
};

const anotherTestLearning: ILearning = {
  id: "bbbbbbbb-2222-4000-8000-000000000002",
  created_at: new Date().toISOString(),
  source: MemoryBankSource.USER,
  scope: MemoryScope.GLOBAL,
  title: "Another learning about errors",
  description: "Error propagation should use Result types for better error handling",
  category: LearningCategory.PATTERN,
  tags: ["error-handling", "functional"],
  confidence: ConfidenceAssessmentLevel.MEDIUM,
  status: MemoryStatus.APPROVED,
};

const unrelatedLearning: ILearning = {
  id: "bbbbbbbb-2222-4000-8000-000000000003",
  created_at: new Date().toISOString(),
  source: MemoryBankSource.EXECUTION,
  scope: MemoryScope.GLOBAL,
  title: "Database optimization tips",
  description: "Use indexes on frequently queried columns for better performance",
  category: LearningCategory.INSIGHT,
  tags: ["database", EvaluationCategory.PERFORMANCE],
  confidence: ConfidenceAssessmentLevel.HIGH,
  status: MemoryStatus.APPROVED,
};

// cosineSimilarity Tests

Deno.test("cosineSimilarity calculates correctly for identical vectors", () => {
  const vectorA = [1, 0, 0, 0];
  const vectorB = [1, 0, 0, 0];

  const similarity = cosineSimilarity(vectorA, vectorB);

  // Identical vectors should have similarity of 1.0
  assertAlmostEquals(similarity, 1.0, 0.001);
});

Deno.test("cosineSimilarity calculates correctly for orthogonal vectors", () => {
  const vectorA = [1, 0, 0, 0];
  const vectorB = [0, 1, 0, 0];

  const similarity = cosineSimilarity(vectorA, vectorB);

  // Orthogonal vectors should have similarity of 0.0
  assertAlmostEquals(similarity, 0.0, 0.001);
});

Deno.test("cosineSimilarity calculates correctly for opposite vectors", () => {
  const vectorA = [1, 0, 0, 0];
  const vectorB = [-1, 0, 0, 0];

  const similarity = cosineSimilarity(vectorA, vectorB);

  // Opposite vectors should have similarity of -1.0
  assertAlmostEquals(similarity, -1.0, 0.001);
});

Deno.test("cosineSimilarity calculates correctly for similar vectors", () => {
  const vectorA = [1, 2, 3, 4];
  const vectorB = [1, 2, 3, 5];

  const similarity = cosineSimilarity(vectorA, vectorB);

  // Similar vectors should have high similarity (close to 1.0)
  assertGreaterOrEqual(similarity, 0.9);
});

// generateMockEmbedding Tests

Deno.test("generateMockEmbedding produces deterministic vectors", () => {
  const text = "This is a test string for embedding";

  // Generate embedding twice
  const embedding1 = generateMockEmbedding(text);
  const embedding2 = generateMockEmbedding(text);

  // Should produce identical vectors
  assertEquals(embedding1.length, embedding2.length);
  for (let i = 0; i < embedding1.length; i++) {
    assertEquals(embedding1[i], embedding2[i]);
  }
});

Deno.test("generateMockEmbedding produces different vectors for different texts", () => {
  const text1 = "Error handling best practices";
  const text2 = "Database optimization techniques";

  const embedding1 = generateMockEmbedding(text1);
  const embedding2 = generateMockEmbedding(text2);

  // Vectors should be different
  let identical = true;
  for (let i = 0; i < embedding1.length; i++) {
    if (embedding1[i] !== embedding2[i]) {
      identical = false;
      break;
    }
  }
  assertEquals(identical, false);
});

Deno.test("generateMockEmbedding produces normalized vectors", () => {
  const text = "This is a test string";
  const embedding = generateMockEmbedding(text);

  // Calculate magnitude
  let magnitude = 0;
  for (const val of embedding) {
    magnitude += val * val;
  }
  magnitude = Math.sqrt(magnitude);

  // Normalized vectors should have magnitude close to 1.0
  assertAlmostEquals(magnitude, 1.0, 0.01);
});

// embedLearning Tests

Deno.test("MemoryEmbeddingService: embedLearning creates embedding file", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed the learning
    await service.embedLearning(testLearning);

    // Check that embedding file was created
    const embeddingPath = join(
      getMemoryIndexDir(config.system.root),
      "embeddings",
      `${testLearning.id}.json`,
    );
    assertEquals(await exists(embeddingPath), true);

    // Verify file content
    const content = await Deno.readTextFile(embeddingPath);
    const embedding = JSON.parse(content);
    assertExists(embedding.id);
    assertExists(embedding.vector);
    assertExists(embedding.text);
    assertEquals(embedding.id, testLearning.id);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryEmbeddingService: embedLearning updates manifest", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed the learning
    await service.embedLearning(testLearning);

    // Check that manifest was updated
    const manifestPath = join(
      getMemoryIndexDir(config.system.root),
      "embeddings",
      "manifest.json",
    );
    assertEquals(await exists(manifestPath), true);

    // Verify manifest content
    const content = await Deno.readTextFile(manifestPath);
    const manifest = JSON.parse(content);
    assertExists(manifest.index);

    // Find our learning in the manifest
    const entry = manifest.index.find((e: { id: string }) => e.id === testLearning.id);
    assertExists(entry);
    assertEquals(entry.title, testLearning.title);
  } finally {
    await cleanup();
  }
});

// searchByEmbedding Tests

Deno.test("MemoryEmbeddingService: searchByEmbedding returns similar entries", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed multiple learnings
    await service.embedLearning(testLearning);
    await service.embedLearning(anotherTestLearning);
    await service.embedLearning(unrelatedLearning);

    // Search for error-related content
    const results = await service.searchByEmbedding("error handling best practices", { limit: 10 });

    // Should return results
    assertGreaterOrEqual(results.length, 1);

    // Verify results have similarity scores
    for (const result of results) {
      assertExists(result.similarity);
      assertGreaterOrEqual(result.similarity, -1);
    }

    // Verify at least one error-related learning is found
    const errorIds = [testLearning.id, anotherTestLearning.id];
    const foundError = results.some((r) => errorIds.includes(r.id));
    assertEquals(foundError, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryEmbeddingService: searchByEmbedding ranks by similarity", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed learnings
    await service.embedLearning(testLearning);
    await service.embedLearning(anotherTestLearning);
    await service.embedLearning(unrelatedLearning);

    // Search
    const results = await service.searchByEmbedding("TypeScript error handling");

    // Results should be sorted by similarity (descending)
    for (let i = 1; i < results.length; i++) {
      const prevSimilarity = results[i - 1].similarity;
      const currSimilarity = results[i].similarity;
      assertGreaterOrEqual(
        prevSimilarity,
        currSimilarity,
        `Results should be sorted by similarity: ${prevSimilarity} >= ${currSimilarity}`,
      );
    }
  } finally {
    await cleanup();
  }
});

// Edge Cases

Deno.test("MemoryEmbeddingService: searchByEmbedding returns empty array when no embeddings exist", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Search without any embeddings
    const results = await service.searchByEmbedding("anything");
    assertEquals(results.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryEmbeddingService: embedLearning handles re-embedding same learning", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed the same learning twice
    await service.embedLearning(testLearning);
    await service.embedLearning(testLearning);

    // Should not create duplicates in manifest
    const manifestPath = join(
      getMemoryIndexDir(config.system.root),
      "embeddings",
      "manifest.json",
    );
    const content = await Deno.readTextFile(manifestPath);
    const manifest = JSON.parse(content);

    // Count entries for our learning
    const entries = manifest.index.filter((e: { id: string }) => e.id === testLearning.id);
    assertEquals(entries.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryEmbeddingService: searchByEmbedding respects limit parameter", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed learnings
    await service.embedLearning(testLearning);
    await service.embedLearning(anotherTestLearning);
    await service.embedLearning(unrelatedLearning);

    // Search with limit
    const results = await service.searchByEmbedding("learning", { limit: 2 });

    // Should return at most 2 results
    assertGreaterOrEqual(2, results.length);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryEmbeddingService: searchByEmbedding respects threshold parameter", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryEmbeddingService(config);

    // Embed learnings
    await service.embedLearning(testLearning);
    await service.embedLearning(unrelatedLearning);

    // Search with high threshold - should return fewer results
    const highThresholdResults = await service.searchByEmbedding(
      "error handling",
      { threshold: 0.9 },
    );

    // Search with low threshold - should return more results
    const lowThresholdResults = await service.searchByEmbedding(
      "error handling",
      { threshold: 0.1 },
    );

    // Low threshold should return at least as many results
    assertGreaterOrEqual(lowThresholdResults.length, highThresholdResults.length);
  } finally {
    await cleanup();
  }
});
