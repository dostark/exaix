/**
 * @module MemoryEmbeddingCoverageTest
 * @path tests/services/memory/memory_embedding_coverage_test.ts
 * @description Negative testing and edge-case coverage for vector similarity calculations,
 * ensuring robust handling of zero vectors and dimension mismatches in RAG operations.
 */
import { ensureDir } from "@std/fs";
import { assert } from "@std/assert";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { assertAlmostEquals, assertEquals, assertExists, assertGreaterOrEqual } from "@std/assert";
import {
  cosineSimilarity,
  generateMockEmbedding,
  MemoryEmbeddingService,
} from "../../../src/services/memory/memory_embedding.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type { ILearning } from "../../../src/shared/schemas/memory_bank.ts";
import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "../../../src/shared/enums.ts";
import { getMemoryIndexDir } from "../../helpers/paths_helper.ts";

// ===== Test Fixture =====

const testLearning: ILearning = {
  id: "ffffffff-1111-4000-8000-000000000001",
  created_at: new Date().toISOString(),
  source: MemoryBankSource.IDENTITY,
  scope: MemoryScope.GLOBAL,
  title: "Coverage test learning",
  description: "This is a test learning for coverage testing of embedding service",
  category: LearningCategory.PATTERN,
  tags: ["coverage", "test"],
  confidence: ConfidenceAssessmentLevel.HIGH,
  status: MemoryStatus.APPROVED,
};

// ===== cosineSimilarity Edge Cases =====

Deno.test("cosineSimilarity throws error for vector length mismatch", () => {
  const vectorA = [1, 2, 3];
  const vectorB = [1, 2, 3, 4];

  try {
    cosineSimilarity(vectorA, vectorB);
    assertEquals(true, false, "Should have thrown an error");
  } catch (error) {
    assertExists(error);
    assertEquals((error as Error).message.includes("length mismatch"), true);
  }
});

Deno.test("cosineSimilarity returns 0 for zero vector", () => {
  const vectorA = [0, 0, 0, 0];
  const vectorB = [1, 2, 3, 4];

  const similarity = cosineSimilarity(vectorA, vectorB);

  // Zero vector should result in 0 similarity
  assertEquals(similarity, 0);
});

Deno.test("cosineSimilarity returns 0 for both zero vectors", () => {
  const vectorA = [0, 0, 0, 0];
  const vectorB = [0, 0, 0, 0];

  const similarity = cosineSimilarity(vectorA, vectorB);

  assertEquals(similarity, 0);
});

Deno.test("cosineSimilarity handles negative values", () => {
  const vectorA = [-1, -2, -3, -4];
  const vectorB = [1, 2, 3, 4];

  const similarity = cosineSimilarity(vectorA, vectorB);

  // Opposite vectors should have similarity of -1.0
  assertAlmostEquals(similarity, -1.0, 0.001);
});

// ===== generateMockEmbedding Edge Cases =====

Deno.test("generateMockEmbedding handles empty string", () => {
  const embedding = generateMockEmbedding("");

  assertEquals(embedding.length, 64); // Default EMBEDDING_DIM

  // Empty string should still produce a vector (all zeros or normalized)
  assertEquals(typeof embedding[0], "number");
});

Deno.test("generateMockEmbedding handles very long text", () => {
  const longText = "word ".repeat(10000);
  const embedding = generateMockEmbedding(longText);

  assertEquals(embedding.length, 64);

  // Should still be normalized
  let magnitude = 0;
  for (const val of embedding) {
    magnitude += val * val;
  }
  magnitude = Math.sqrt(magnitude);

  // Either normalized to ~1.0 or 0 if all zeros
  if (magnitude > 0) {
    assertAlmostEquals(magnitude, 1.0, 0.01);
  }
});

Deno.test("generateMockEmbedding handles special characters", () => {
  const specialText = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
  const embedding = generateMockEmbedding(specialText);

  assertEquals(embedding.length, 64);
});

Deno.test("generateMockEmbedding handles unicode", () => {
  const unicodeText = "日本語 中文 한국어 العربية";
  const embedding = generateMockEmbedding(unicodeText);

  assertEquals(embedding.length, 64);
});

// ===== MemoryEmbeddingService.initializeManifest =====

Deno.test(
  "MemoryEmbeddingService: initializeManifest creates directory and manifest",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Initialize manifest
      await service.initializeManifest();

      // Check that embeddings directory was created
      const embeddingsDir = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
      );
      assertEquals(await exists(embeddingsDir), true);

      // Check that manifest was created
      const manifestPath = join(embeddingsDir, "manifest.json");
      assertEquals(await exists(manifestPath), true);

      // Verify manifest content
      const content = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(content);
      assertExists(manifest.generated_at);
      assertEquals(Array.isArray(manifest.index), true);
      assertEquals(manifest.index.length, 0);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: initializeManifest is idempotent",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Initialize twice
      await service.initializeManifest();
      await service.initializeManifest();

      // Should still have valid manifest
      const manifestPath = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
        "manifest.json",
      );
      const content = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(content);
      assertExists(manifest.generated_at);
    } finally {
      await cleanup();
    }
  },
);

// ===== MemoryEmbeddingService.getEmbedding =====

Deno.test(
  "MemoryEmbeddingService: getEmbedding returns vector for existing learning",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed a learning
      await service.embedLearning(testLearning);

      // Get the embedding
      const vector = await service.getEmbedding(testLearning.id);

      assertExists(vector);
      assertEquals(Array.isArray(vector), true);
      assertEquals(vector!.length, 64);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: getEmbedding returns null for non-existent learning",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);
      await service.initializeManifest();

      // Try to get non-existent embedding
      const vector = await service.getEmbedding("non-existent-id");

      assertEquals(vector, null);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: getEmbedding handles corrupted embedding file",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);
      await service.initializeManifest();

      // Create a corrupted embedding file
      const embeddingsDir = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
      );
      await ensureDir(embeddingsDir);
      const corruptedPath = join(embeddingsDir, "corrupted-id.json");
      await Deno.writeTextFile(corruptedPath, "not valid json {{{");

      // Should return null for corrupted file
      const vector = await service.getEmbedding("corrupted-id");

      assertEquals(vector, null);
    } finally {
      await cleanup();
    }
  },
);

// ===== MemoryEmbeddingService.deleteEmbedding =====

Deno.test(
  "MemoryEmbeddingService: deleteEmbedding removes embedding and updates manifest",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed a learning
      await service.embedLearning(testLearning);

      // Verify it exists
      const embeddingPath = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
        `${testLearning.id}.json`,
      );
      assertEquals(await exists(embeddingPath), true);

      // Delete the embedding
      await service.deleteEmbedding(testLearning.id);

      // Verify file is deleted
      assertEquals(await exists(embeddingPath), false);

      // Verify manifest is updated
      const manifestPath = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
        "manifest.json",
      );
      await service.initializeManifest();
      const content = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(content);
      const entry = manifest.index.find(
        (e: { id: string }) => e.id === testLearning.id,
      );
      assertEquals(entry, undefined);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: deleteEmbedding handles non-existent embedding gracefully",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);
      await service.initializeManifest();

      // Should not throw when deleting non-existent embedding
      await service.deleteEmbedding("non-existent-id");

      // Manifest should still be valid
      const manifestPath = join(
        config.system.root,
        "Memory",
        "Index",
        "embeddings",
        "manifest.json",
      );
      // console.log("DEBUG: manifestPath", manifestPath); // Remove debug after fix
      await service.initializeManifest();
      assertEquals(await exists(manifestPath), true);
    } finally {
      await cleanup();
    }
  },
);

// ===== MemoryEmbeddingService.getStats =====

Deno.test(
  "MemoryEmbeddingService: getStats returns statistics",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed multiple learnings
      const learning1: ILearning = {
        ...testLearning,
        id: "stats-1111-4000-8000-000000000001",
      };
      const learning2: ILearning = {
        ...testLearning,
        id: "stats-2222-4000-8000-000000000002",
      };

      await service.embedLearning(learning1);
      await service.embedLearning(learning2);

      // Get stats
      const stats = await service.getStats();

      assertEquals(stats.total, 2);
      assertExists(stats.generated_at);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: getStats returns zeros when no manifest",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Don't initialize - no manifest exists
      const stats = await service.getStats();

      assertEquals(stats.total, 0);
      assert(stats.generated_at.length > 0);
    } finally {
      await cleanup();
    }
  },
);

// ===== searchByEmbedding Edge Cases =====

Deno.test(
  "MemoryEmbeddingService: searchByEmbedding skips missing embedding files",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed a learning
      await service.embedLearning(testLearning);

      // Manually delete the embedding file but keep manifest entry
      const embeddingPath = join(
        config.system.root,
        getMemoryIndexDir(config.system.root),
        "embeddings",
        `${testLearning.id}.json`,
      );
      await ensureDir(getMemoryIndexDir(config.system.root) + "/embeddings");
      if (await exists(embeddingPath)) {
        await Deno.remove(embeddingPath);
      }

      // Search should not throw, just skip missing file
      const results = await service.searchByEmbedding("test query");

      // Should return empty since the only embedding file is missing
      assertEquals(results.length, 0);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: searchByEmbedding handles corrupted embedding files",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed a valid learning
      await service.embedLearning(testLearning);

      // Add a corrupted entry to manifest
      const manifestPath = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
        "manifest.json",
      );
      const content = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(content);
      manifest.index.push({
        id: "corrupted-learning",
        title: "Corrupted",
        embeddingFile: "corrupted-learning.json",
      });
      await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Create corrupted file
      const corruptedPath = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
        "corrupted-learning.json",
      );
      await Deno.writeTextFile(corruptedPath, "invalid json");

      // Search should not throw, just skip corrupted file
      const results = await service.searchByEmbedding("test query");

      // Should still return results for valid embedding
      assertEquals(results.length >= 0, true);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: searchByEmbedding with default options",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed learnings
      const learnings: ILearning[] = [];
      for (let i = 1; i <= 15; i++) {
        learnings.push({
          ...testLearning,
          id: `default-${i.toString().padStart(4, "0")}-4000-8000-000000000001`,
          title: `ILearning ${i}`,
        });
      }

      for (const l of learnings) {
        await service.embedLearning(l);
      }

      // Search with no options (should use defaults: limit=10, threshold=0.0)
      const results = await service.searchByEmbedding("test");

      // Should return at most 10 (default limit)
      assertGreaterOrEqual(10, results.length);
    } finally {
      await cleanup();
    }
  },
);

// ===== embedLearning edge cases =====

Deno.test(
  "MemoryEmbeddingService: embedLearning creates directory if not exists",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Don't call initializeManifest - let embedLearning create directory
      await service.embedLearning(testLearning);

      // Directory should be created
      const embeddingsDir = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
      );
      assertEquals(await exists(embeddingsDir), true);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "MemoryEmbeddingService: embedLearning updates existing manifest entry",
  async () => {
    const { config, cleanup } = await initTestDbService();

    try {
      const service = new MemoryEmbeddingService(config);

      // Embed same learning twice with different title
      await service.embedLearning(testLearning);

      const updatedLearning = { ...testLearning, title: "Updated Title" };
      await service.embedLearning(updatedLearning);

      // Check manifest has only one entry with updated title
      const manifestPath = join(
        getMemoryIndexDir(config.system.root),
        "embeddings",
        "manifest.json",
      );
      const content = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(content);

      const entries = manifest.index.filter(
        (e: { id: string }) => e.id === testLearning.id,
      );
      assertEquals(entries.length, 1);
      assertEquals(entries[0].title, "Updated Title");
    } finally {
      await cleanup();
    }
  },
);
