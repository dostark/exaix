/**
 * @module MemorySearchTest
 * @path packages/memory/tests/bank/memory_search_test.ts
 * @related-files []
 * @architectural-layer Memory
 * @description Verifies the logic for tag-based memory retrieval, ensuring correctly scoped
 * access to project-specific and global learned patterns via the MemoryBankService.
 */

import { assertEquals, assertExists, assertGreaterOrEqual } from "@std/assert";
import {
  ConfidenceAssessmentLevel,
  EvaluationCategory,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "@exaix/core";
import { join } from "@std/path";
import { MemoryBankService } from "@exaix/memory";
import { initTestDbService } from "@exaix/testing";
import type { ILearning, IProjectMemory } from "@exaix/schemas/memory_bank.ts";
import { MemoryStatus } from "@exaix/core/status";
import { getMemoryGlobalDir } from "@exaix/testing";

// Test Setup Helpers

/**
 * Create test project memory with tags
 */
async function setupTestProjectWithTags(
  service: MemoryBankService,
): Promise<void> {
  const projectMem: IProjectMemory = {
    portal: "search-test-project",
    overview: "A project for testing search functionality",
    patterns: [
      {
        name: "Repository IPattern as IPattern",
        description: "Database access through repository classes",
        examples: ["src/repos/user_repo.ts"],
        tags: ["database", "architecture", "typescript"],
      },
      {
        name: "Factory IPattern as IPattern",
        description: "Object creation using factory methods",
        examples: ["src/factories/user_factory.ts"],
        tags: ["creational", "design-pattern", "typescript"],
      },
      {
        name: "Observer IPattern as IPattern",
        description: "Event-driven communication between objects",
        examples: ["src/events/event_bus.ts"],
        tags: ["behavioral", "design-pattern", "events"],
      },
    ],
    decisions: [
      {
        date: "2026-01-04",
        decision: "Use SQLite for local storage",
        rationale: "Lightweight, no external dependencies",
        tags: ["database", "architecture"],
      },
      {
        date: "2026-01-05",
        decision: "Adopt TypeScript strict mode",
        rationale: "Better type safety and IDE support",
        tags: ["typescript", "tooling"],
      },
    ],
    references: [],
  };

  await service.createProjectMemory(projectMem);
}

/**
 * Create test global learning with tags
 */
async function setupTestLearnings(
  _service: MemoryBankService,
  configRoot: string,
): Promise<void> {
  const learnings: ILearning[] = [
    {
      id: "aaaaaaaa-1111-4000-8000-000000000001",
      created_at: new Date().toISOString(),
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Error handling best practice",
      description: "Always wrap async operations in try-catch for proper error propagation",
      category: LearningCategory.PATTERN,
      tags: ["error-handling", "typescript", "async"],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    },
    {
      id: "aaaaaaaa-1111-4000-8000-000000000002",
      created_at: new Date().toISOString(),
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Avoid callback hell",
      description: "Use async/await instead of nested callbacks for better readability",
      category: LearningCategory.ANTI_PATTERN,
      tags: ["async", "code-quality", "typescript"],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    },
    {
      id: "aaaaaaaa-1111-4000-8000-000000000003",
      created_at: new Date().toISOString(),
      source: MemoryBankSource.EXECUTION,
      source_id: "trace-123",
      scope: MemoryScope.PROJECT,
      project: "search-test-project",
      title: "Database connection pooling",
      description: "Use connection pooling to avoid exhausting database connections",
      category: LearningCategory.INSIGHT,
      tags: ["database", EvaluationCategory.PERFORMANCE],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      status: MemoryStatus.APPROVED,
    },
  ];

  // Write learnings to global memory
  const globalDir = getMemoryGlobalDir(configRoot);
  await Deno.mkdir(globalDir, { recursive: true });
  await Deno.writeTextFile(
    join(globalDir, "learnings.json"),
    JSON.stringify(learnings, null, 2),
  );
}

// searchByTags Tests

// Helper for running memory search tests
async function runMemorySearchTest(
  options: { includeLearnings?: boolean } = {},
  fn: (service: MemoryBankService) => Promise<void>,
) {
  const { config, cleanup } = await initTestDbService();
  try {
    const service = new MemoryBankService(config);
    await setupTestProjectWithTags(service);
    if (options.includeLearnings) {
      await setupTestLearnings(service, config.system.root);
    }
    await fn(service);
  } finally {
    await cleanup();
  }
}

// searchByTags Tests

Deno.test("MemoryBankService: searchByTags returns matching entries (single tag)", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Search by single tag
    const results = await service.searchByTags(["typescript"]);

    // Should find patterns and learnings with 'typescript' tag
    assertGreaterOrEqual(results.length, 3);

    // All results should have the typescript tag
    for (const result of results) {
      assertExists(result.tags);
      assertEquals(result.tags?.includes("typescript"), true, `Result ${result.title} should have 'typescript' tag`);
    }
  });
});

Deno.test("MemoryBankService: searchByTags returns matching entries (database tag)", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Search by database tag
    const results = await service.searchByTags(["database"]);

    // Should find Repository IPattern as IPattern, SQLite decision, and connection pooling learning
    assertGreaterOrEqual(results.length, 2);

    // All results should have the database tag
    for (const result of results) {
      assertExists(result.tags);
      assertEquals(result.tags?.includes("database"), true);
    }
  });
});

Deno.test("MemoryBankService: searchByTags with multiple tags uses AND logic", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Search by multiple tags (AND logic)
    const results = await service.searchByTags(["typescript", "async"]);

    // Should only find items with BOTH tags
    assertGreaterOrEqual(results.length, 1);

    for (const result of results) {
      assertExists(result.tags);
      assertEquals(result.tags?.includes("typescript"), true);
      assertEquals(result.tags?.includes("async"), true);
    }
  });
});

// searchByKeyword Tests

Deno.test("MemoryBankService: searchByKeyword finds text matches in titles", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Search by keyword in title
    const results = await service.searchByKeyword(LearningCategory.PATTERN);

    // Should find patterns with "IPattern as IPattern" in the name
    assertGreaterOrEqual(results.length, 3);

    // Check that results contain expected items
    const titles = results.map((r) => r.title.toLowerCase());
    assertEquals(titles.some((t) => t.includes("repository")), true);
    assertEquals(titles.some((t) => t.includes("factory")), true);
  });
});

Deno.test("MemoryBankService: searchByKeyword finds text matches in descriptions", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Search by keyword in description
    const results = await service.searchByKeyword("async");

    // Should find learnings with "async" in description
    assertGreaterOrEqual(results.length, 1);

    // Check that results contain expected items
    const descriptions = results.map((r) => r.summary.toLowerCase());
    assertEquals(descriptions.some((d) => d.includes("async")), true);
  });
});

Deno.test("MemoryBankService: searchByKeyword ranks by frequency", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Search by keyword that appears multiple times in some entries
    const results = await service.searchByKeyword("database");

    // Results should be sorted by relevance score
    assertGreaterOrEqual(results.length, 2);

    // Verify results are sorted by relevance (descending)
    for (let i = 1; i < results.length; i++) {
      // Safe access with optional chaining if undefined
      const prevScore = results[i - 1].relevance_score ?? 0;
      const currScore = results[i].relevance_score ?? 0;
      assertGreaterOrEqual(
        prevScore,
        currScore,
        `Results should be sorted by relevance: ${prevScore} >= ${currScore}`,
      );
    }
  });
});

// Combined Search Tests

Deno.test("MemoryBankService: combined search uses tiered approach (tags first)", async () => {
  await runMemorySearchTest({ includeLearnings: true }, async (service) => {
    // Combined search with tags and keyword
    const results = await service.searchMemoryAdvanced({
      tags: ["typescript"],
      keyword: LearningCategory.PATTERN,
    });

    // Tag matches should have higher relevance than keyword-only matches
    assertGreaterOrEqual(results.length, 1);

    // First result should have both tag and keyword match (highest relevance)
    const topResult = results[0];
    assertExists(topResult.tags);
    assertEquals(topResult.tags?.includes("typescript"), true);
  });
});

Deno.test("MemoryBankService: combined search falls back to keyword if no tag matches", async () => {
  await runMemorySearchTest({}, async (service) => {
    // Search with non-existent tag but valid keyword
    const results = await service.searchMemoryAdvanced({
      tags: ["nonexistent-tag"],
      keyword: "database",
    });

    // Should still return keyword matches even though no tag matches
    assertGreaterOrEqual(results.length, 1);
  });
});

// Edge Cases

Deno.test("MemoryBankService: searchByTags returns empty array for non-existent tags", async () => {
  await runMemorySearchTest({}, async (service) => {
    const results = await service.searchByTags(["nonexistent-tag-xyz"]);
    assertEquals(results.length, 0);
  });
});

Deno.test("MemoryBankService: searchByKeyword returns empty array for non-matching keywords", async () => {
  await runMemorySearchTest({}, async (service) => {
    const results = await service.searchByKeyword("zzzznonexistentkeywordzzz");
    assertEquals(results.length, 0);
  });
});

Deno.test("MemoryBankService: searchByTags is case-insensitive", async () => {
  await runMemorySearchTest({}, async (service) => {
    // Search with different cases
    const upperResults = await service.searchByTags(["TYPESCRIPT"]);
    const lowerResults = await service.searchByTags(["typescript"]);
    const mixedResults = await service.searchByTags(["TypeScript"]);

    // All should return the same results
    assertEquals(upperResults.length, lowerResults.length);
    assertEquals(upperResults.length, mixedResults.length);
  });
});
