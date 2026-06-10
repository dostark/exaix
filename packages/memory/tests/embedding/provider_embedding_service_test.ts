/**
 * @module ProviderEmbeddingServiceTest
 * @path packages/memory/tests/embedding/provider_embedding_service_test.ts
 * @related-files []
 * @architectural-layer Memory
 * @description Tests for ProviderEmbeddingService implementing
 * IMemoryEmbeddingService with a mock IEmbeddingProvider.
 */

import { assert, assertEquals } from "@std/assert";
import { ProviderEmbeddingService } from "@exaix/memory";
import type { IEmbeddingProvider } from "@exaix/ai";
import { createTestLearning } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";

const TEST_VECTOR_1 = [0.1, 0.2, 0.3, 0.4, 0.5];
const TEST_VECTOR_2 = [0.15, 0.25, 0.35, 0.45, 0.55];
const TEST_VECTOR_QUERY = [0.12, 0.22, 0.32, 0.42, 0.52];

function createMockProvider(vectors: number[][]): IEmbeddingProvider {
  return {
    providerId: "mock",
    dimension: vectors[0]?.length ?? 0,
    async embed(_texts: string[]): Promise<number[][]> {
      await Promise.resolve();
      return vectors;
    },
  };
}

async function createTestService(
  provider: IEmbeddingProvider,
): Promise<{ service: ProviderEmbeddingService; tempDir: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-embed-test-" });
  const config = {
    system: { root: tempDir, log_level: "info", schema_version: "1.0.0", version: "1.0.0" },
    paths: {
      memory: "./Memory",
      blueprints: "./Blueprints",
      runtime: "./.exa",
      workspace: "./Workspace",
      portals: "./Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      identities: "Identities",
      flows: "Flows",
      memoryProjects: "Projects",
      memoryExecution: "Execution",
      memoryIndex: "Index",
      memorySkills: "Skills",
      memoryPending: "Pending",
      memoryTasks: "Tasks",
      memoryGlobal: "Global",
    },
  } as Config;

  const service = new ProviderEmbeddingService(config, provider);

  return {
    service,
    tempDir,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

Deno.test("ProviderEmbeddingService: embedLearning stores vector and caches result", async () => {
  const provider = createMockProvider([TEST_VECTOR_1]);
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.initializeManifest();

    const learning = createTestLearning({ id: "learn-1", title: "Test Learning", description: "Test description" });
    await service.embedLearning(learning);

    const vector = await service.getEmbedding("learn-1");
    assertEquals(vector, TEST_VECTOR_1);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: searchByEmbedding returns results ordered by similarity", async () => {
  let callCount = 0;
  const provider: IEmbeddingProvider = {
    providerId: "mock",
    dimension: 5,
    async embed(_texts: string[]): Promise<number[][]> {
      await Promise.resolve();
      callCount++;
      if (callCount <= 2) return [TEST_VECTOR_1];
      if (callCount === 3) return [TEST_VECTOR_2];
      return [TEST_VECTOR_QUERY];
    },
  };
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.embedLearning(createTestLearning({ id: "l1", title: "Alpha", description: "First learning" }));
    await service.embedLearning(createTestLearning({ id: "l2", title: "Beta", description: "Second learning" }));

    const results = await service.searchByEmbedding("query text", { limit: 5 });

    assertEquals(results.length, 2);
    assert(results[0].similarity >= results[1].similarity);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: searchByEmbedding respects threshold", async () => {
  let callCount = 0;
  const provider: IEmbeddingProvider = {
    providerId: "mock",
    dimension: 5,
    async embed(_texts: string[]): Promise<number[][]> {
      await Promise.resolve();
      callCount++;
      if (callCount === 1) return [[1, 0, 0, 0, 0]];
      if (callCount === 2) return [[0, 1, 0, 0, 0]];
      return [[0.5, 0.5, 0, 0, 0]];
    },
  };
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.embedLearning(createTestLearning({ id: "l1", title: "A", description: "One" }));

    const results = await service.searchByEmbedding("query", { threshold: 0.9 });
    assertEquals(results.length, 0);

    const results2 = await service.searchByEmbedding("query", { threshold: 0.0 });
    assertEquals(results2.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: deleteEmbedding removes file and manifest entry", async () => {
  const provider = createMockProvider([TEST_VECTOR_1]);
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.embedLearning(
      createTestLearning({ id: "del-1", title: "To Delete", description: "Will be removed" }),
    );

    let vector = await service.getEmbedding("del-1");
    assertEquals(vector, TEST_VECTOR_1);

    await service.deleteEmbedding("del-1");

    vector = await service.getEmbedding("del-1");
    assertEquals(vector, null);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: getStats returns correct count", async () => {
  const provider = createMockProvider([TEST_VECTOR_1]);
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.embedLearning(createTestLearning({ id: "s1", title: "A", description: "One" }));
    await service.embedLearning(createTestLearning({ id: "s2", title: "B", description: "Two" }));

    const stats = await service.getStats();
    assertEquals(stats.total, 2);
    assertEquals(typeof stats.generated_at, "string");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: LRU cache prevents redundant API calls for duplicate text", async () => {
  let embedCallCount = 0;
  const provider: IEmbeddingProvider = {
    providerId: "mock",
    dimension: 5,
    async embed(_texts: string[]): Promise<number[][]> {
      await Promise.resolve();
      embedCallCount++;
      return [TEST_VECTOR_1];
    },
  };
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.embedLearning(createTestLearning({ id: "c1", title: "Identical", description: "Text" }));
    await service.embedLearning(createTestLearning({ id: "c2", title: "Identical", description: "Text" }));

    assertEquals(embedCallCount, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: searchByEmbedding returns empty for no learnings", async () => {
  const provider = createMockProvider([TEST_VECTOR_QUERY]);
  const { service, cleanup } = await createTestService(provider);
  try {
    const results = await service.searchByEmbedding("anything");
    assertEquals(results.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: getEmbedding returns null for unknown id", async () => {
  const provider = createMockProvider([TEST_VECTOR_1]);
  const { service, cleanup } = await createTestService(provider);
  try {
    const result = await service.getEmbedding("nonexistent");
    assertEquals(result, null);
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: deleteEmbedding is idempotent for missing id", async () => {
  const provider = createMockProvider([TEST_VECTOR_1]);
  const { service, cleanup } = await createTestService(provider);
  try {
    await service.deleteEmbedding("nonexistent");
  } finally {
    await cleanup();
  }
});

Deno.test("ProviderEmbeddingService: defaults to OllamaEmbeddingClient when no provider given", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-embed-default-test-" });
  const config = {
    system: { root: tempDir, log_level: "info", schema_version: "1.0.0", version: "1.0.0" },
    paths: {
      memory: "./Memory",
      blueprints: "./Blueprints",
      runtime: "./.exa",
      workspace: "./Workspace",
      portals: "./Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      identities: "Identities",
      flows: "Flows",
      memoryProjects: "Projects",
      memoryExecution: "Execution",
      memoryIndex: "Index",
      memorySkills: "Skills",
      memoryPending: "Pending",
      memoryTasks: "Tasks",
      memoryGlobal: "Global",
    },
  } as Config;

  // Should not throw when no provider is provided — defaults to OllamaEmbeddingClient
  const service = new ProviderEmbeddingService(config);
  assert(service instanceof ProviderEmbeddingService);

  // initializeManifest doesn't call the provider — just creates the directory + manifest file
  await service.initializeManifest();

  await Deno.remove(tempDir, { recursive: true });
});
