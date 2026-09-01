/**
 * @module MemoryIndexRebuildTest
 * @path packages/memory/tests/rebuild_index_test.ts
 * @description Verifies the batch re-indexing of memory banks, ensuring correct regeneration of
 * keyword indices and embedding vectors across project and global scopes.
 */

import { assertEquals, assertExists, assertGreaterOrEqual } from "@std/assert";
import { MemoryStatus } from "@exaix/core/status";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";

import { join } from "@std/path";
import { exists } from "@std/fs";
import { MemoryBankService } from "@exaix/memory";
import { MemoryEmbeddingService } from "@exaix/memory";
import { initTestDbService } from "@exaix/testing";
import type { ILearning, IProjectMemory } from "@exaix/schemas/memory_bank.ts";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import { getMemoryGlobalDir, getMemoryIndexDir } from "@exaix/testing";

// Test Setup Helpers

/**
 * Set up test data for rebuild-index tests
 */
async function setupTestData(
  service: MemoryBankService,
  configRoot: string,
): Promise<void> {
  // Create project memory with patterns and decisions
  const projectMem: IProjectMemory = {
    portal: "rebuild-test-project",
    overview: "A project for testing rebuild-index",
    patterns: [
      {
        name: "Singleton IPattern as IPattern",
        description: "Single instance of a class",
        examples: ["src/services/config.ts"],
        tags: ["creational", "design-pattern"],
      },
      {
        name: "Adapter IPattern as IPattern",
        description: "Bridge between incompatible interfaces",
        examples: ["src/adapters/api_adapter.ts"],
        tags: ["structural", "design-pattern"],
      },
    ],
    decisions: [
      {
        date: "2026-01-04",
        decision: "Use TypeScript for type safety",
        rationale: "Better maintainability",
        tags: ["typescript", "tooling"],
      },
    ],
    references: [],
  };

  await service.createProjectMemory(projectMem);

  // Create global learnings
  const learnings: ILearning[] = [
    {
      id: "cccccccc-3333-4000-8000-000000000001",
      created_at: new Date().toISOString(),
      source: MemoryBankSource.IDENTITY,
      scope: MemoryScope.GLOBAL,
      title: "Code review checklist",
      description: "Always check for proper error handling and edge cases",
      category: LearningCategory.INSIGHT,
      tags: ["code-review", "best-practices"],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    },
    {
      id: "cccccccc-3333-4000-8000-000000000002",
      created_at: new Date().toISOString(),
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Documentation standards",
      description: "Use JSDoc for all public functions and classes",
      category: LearningCategory.PATTERN,
      tags: ["documentation", "typescript"],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      status: MemoryStatus.APPROVED,
    },
  ];

  const globalDir = getMemoryGlobalDir(configRoot);
  await Deno.mkdir(globalDir, { recursive: true });
  await Deno.writeTextFile(
    join(globalDir, "learnings.json"),
    JSON.stringify(learnings, null, 2),
  );
}

// rebuildIndices Tests

Deno.test("MemoryBankService: rebuildIndices regenerates all indices", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config);
    await setupTestData(service, config.system.root);

    // Rebuild indices
    await service.rebuildIndices();

    // Check that index files were created
    const indexDir = getMemoryIndexDir(config.system.root);
    assertEquals(await exists(join(indexDir, "files.json")), true);
    assertEquals(await exists(join(indexDir, "patterns.json")), true);
    assertEquals(await exists(join(indexDir, "tags.json")), true);

    // Verify patterns index content
    const patternsContent = await Deno.readTextFile(join(indexDir, "patterns.json"));
    const patternsIndex = JSON.parse(patternsContent);
    assertExists(patternsIndex["Singleton IPattern as IPattern"]);
    assertExists(patternsIndex["Adapter IPattern as IPattern"]);

    // Verify tags index content
    const tagsContent = await Deno.readTextFile(join(indexDir, "tags.json"));
    const tagsIndex = JSON.parse(tagsContent);
    assertExists(tagsIndex["design-pattern"]);
    assertEquals(tagsIndex["design-pattern"].length, 2); // Both patterns have this tag
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: rebuildIndicesWithEmbeddings includes embeddings", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const memoryService = new MemoryBankService(config);
    const embeddingService = new MemoryEmbeddingService(config);
    await setupTestData(memoryService, config.system.root);

    // Rebuild indices with embeddings
    await memoryService.rebuildIndicesWithEmbeddings(embeddingService);

    // Check that embedding files were created
    const embeddingsDir = join(getMemoryIndexDir(config.system.root), "embeddings");
    assertEquals(await exists(embeddingsDir), true);
    assertEquals(await exists(join(embeddingsDir, "manifest.json")), true);

    // Verify manifest content
    const manifestContent = await Deno.readTextFile(join(embeddingsDir, "manifest.json"));
    const manifest = JSON.parse(manifestContent);
    assertExists(manifest.index);
    assertGreaterOrEqual(manifest.index.length, 1);
  } finally {
    await cleanup();
  }
});

// Index Content Verification

Deno.test("MemoryBankService: rebuildIndices indexes learnings tags", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config);
    await setupTestData(service, config.system.root);

    // Rebuild indices
    await service.rebuildIndices();

    // Check that learnings tags are indexed
    const indexDir = getMemoryIndexDir(config.system.root);
    const tagsContent = await Deno.readTextFile(join(indexDir, "tags.json"));
    const tagsIndex = JSON.parse(tagsContent);

    // Should have learning tags indexed
    assertExists(tagsIndex["code-review"]);
    assertExists(tagsIndex["documentation"]);
    assertExists(tagsIndex["best-practices"]);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: rebuildIndices preserves existing data on rebuild", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config);
    await setupTestData(service, config.system.root);

    // First rebuild
    await service.rebuildIndices();

    // Add another pattern
    await service.addPattern("rebuild-test-project", {
      name: "Observer IPattern as IPattern",
      description: "Event notification system",
      examples: ["src/events/emitter.ts"],
      tags: ["behavioral", "design-pattern"],
    });

    // Second rebuild
    await service.rebuildIndices();

    // Verify all patterns are still indexed
    const indexDir = getMemoryIndexDir(config.system.root);
    const patternsContent = await Deno.readTextFile(join(indexDir, "patterns.json"));
    const patternsIndex = JSON.parse(patternsContent);

    assertExists(patternsIndex["Singleton IPattern as IPattern"]);
    assertExists(patternsIndex["Adapter IPattern as IPattern"]);
    assertExists(patternsIndex["Observer IPattern as IPattern"]);
  } finally {
    await cleanup();
  }
});

// Edge Cases

Deno.test("MemoryBankService: rebuildIndices handles empty memory banks", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const service = new MemoryBankService(config);

    // Rebuild without any data
    await service.rebuildIndices();

    // Check that index files were still created (empty)
    const indexDir = getMemoryIndexDir(config.system.root);
    assertEquals(await exists(join(indexDir, "files.json")), true);
    assertEquals(await exists(join(indexDir, "patterns.json")), true);
    assertEquals(await exists(join(indexDir, "tags.json")), true);

    // Verify they contain empty objects
    const patternsContent = await Deno.readTextFile(join(indexDir, "patterns.json"));
    assertEquals(patternsContent.trim(), "{}");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: rebuildIndicesWithEmbeddings handles no learnings", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const memoryService = new MemoryBankService(config);
    const embeddingService = new MemoryEmbeddingService(config);

    // Create project memory without learnings
    await memoryService.createProjectMemory({
      portal: "empty-test-project",
      overview: "Test project",
      patterns: [],
      decisions: [],
      references: [],
    });

    // Rebuild indices with embeddings
    await memoryService.rebuildIndicesWithEmbeddings(embeddingService);

    // Check that embeddings directory was created
    const embeddingsDir = join(getMemoryIndexDir(config.system.root), "embeddings");
    assertEquals(await exists(embeddingsDir), true);

    // Manifest should exist with only the project overview embedded (no learnings/patterns/decisions)
    const manifestPath = join(embeddingsDir, "manifest.json");
    assertEquals(await exists(manifestPath), true);
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
    assertEquals(manifest.index.length, 1);
    assertEquals(manifest.index[0].id, "empty-test-project:overview");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryBankService: index and embedding rebuild events persist through a real EventLogger", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const memoryService = new MemoryBankService(config, new EventLogger({ db }));
    const embeddingService = new MemoryEmbeddingService(config);
    await setupTestData(memoryService, config.system.root);

    await memoryService.rebuildIndicesWithEmbeddings(embeddingService);
    await db.waitForFlush();

    const indexRows = db.getActivitiesByActionType(DomainEventType.MemoryIndicesRebuilt);
    assertEquals(indexRows.length, 1, "memory.indices.rebuilt must persist exactly once");
    const indexPayload = JSON.parse(indexRows[0].payload);
    assertEquals(indexPayload.patterns_indexed, 2);
    assertGreaterOrEqual(indexPayload.tags_indexed, 1);

    const embeddingRows = db.getActivitiesByActionType(DomainEventType.MemoryEmbeddingsRebuilt);
    assertEquals(embeddingRows.length, 1, "memory.embeddings.rebuilt must persist exactly once");
    assertEquals(JSON.parse(embeddingRows[0].payload).learnings_embedded, 2);
  } finally {
    await cleanup();
  }
});
