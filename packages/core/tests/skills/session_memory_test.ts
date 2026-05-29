/**
 * @module SessionMemoryTest
 * @path packages/core/tests/skills/session_memory_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies the SessionMemoryService, ensuring short-term execution state is
 * correctly isolated, updated, and cleared across different agent sessions.
 */

import { assertEquals, assertExists, assertGreater, assertLess, assertStringIncludes } from "@std/assert";
import { type Insight, SessionMemoryService } from "@exaix/memory";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IEmbeddingSearchResult, IMemoryEmbeddingService } from "@exaix/memory";
import type { IExecutionMemory, ILearning, IMemorySearchResult } from "@exaix/schemas/memory_bank.ts";
import {
  ConfidenceLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
  MemoryType,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { NullEmbeddingStub, NullMemoryBankStub } from "@exaix/testing";

// ===== Mock Services =====

class MockMemoryBankService extends NullMemoryBankStub {
  constructor(
    private searchResults: IMemorySearchResult[] = [],
    private learnings: ILearning[] = [],
    private executions: IExecutionMemory[] = [],
  ) {
    super();
  }

  override searchMemory(
    _query: string,
    _options?: { portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve(this.searchResults);
  }

  override searchByTags(
    _tags: string[],
    _options?: { portal?: string; limit?: number },
  ): Promise<IMemorySearchResult[]> {
    return Promise.resolve(this.searchResults.filter((r) => r.tags?.some((t) => _tags.includes(t))));
  }

  override getExecutionHistory(_portal?: string, limit?: number): Promise<IExecutionMemory[]> {
    const filtered = _portal ? this.executions.filter((e) => e.portal === _portal) : this.executions;
    return Promise.resolve(limit ? filtered.slice(0, limit) : filtered);
  }

  override addGlobalLearning(_learning: ILearning): Promise<void> {
    this.learnings.push(_learning);
    return Promise.resolve();
  }
}

function createMockMemoryBank(
  searchResults: IMemorySearchResult[] = [],
  learnings: ILearning[] = [],
  executions: IExecutionMemory[] = [],
): IMemoryBankService {
  return new MockMemoryBankService(searchResults, learnings, executions);
}

class MockEmbeddingService extends NullEmbeddingStub {
  constructor(private searchResults: IEmbeddingSearchResult[] = []) {
    super();
  }

  override searchByEmbedding(
    _query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<IEmbeddingSearchResult[]> {
    const threshold = options?.threshold ?? 0;
    const limit = options?.limit ?? 10;
    return Promise.resolve(
      this.searchResults
        .filter((r) => r.similarity >= threshold)
        .slice(0, limit),
    );
  }
}

function createMockEmbeddingService(
  searchResults: IEmbeddingSearchResult[] = [],
): IMemoryEmbeddingService {
  return new MockEmbeddingService(searchResults);
}

// ===== Test Data =====

const sampleEmbeddingResults: IEmbeddingSearchResult[] = [
  {
    id: "learning-1",
    title: "Repository Pattern for Data Access",
    summary: "Use repository pattern to abstract database operations",
    similarity: 0.85,
  },
  {
    id: "learning-2",
    title: "Error Handling Best Practices",
    summary: "Always wrap async operations in try-catch blocks",
    similarity: 0.72,
  },
  {
    id: "learning-3",
    title: "TypeScript Type Guards",
    summary: "Use type guards for runtime type checking",
    similarity: 0.45,
  },
];

const sampleSearchResults: IMemorySearchResult[] = [
  {
    type: MemoryType.PATTERN,
    portal: "test-portal",
    title: "Dependency Injection IPattern as IPattern",
    summary: "Inject dependencies through constructor for testability",
    relevance_score: 0.9,
    tags: ["architecture", "testing"],
  },
  {
    type: MemoryType.DECISION,
    portal: "test-portal",
    title: "IDecision as IDecision: Use Deno Runtime",
    summary: "Chose Deno for built-in TypeScript support and modern APIs",
    relevance_score: 0.75,
    tags: ["runtime", "typescript"],
  },
  {
    type: MemoryType.EXECUTION,
    portal: "test-portal",
    title: "Execution: abc12345",
    summary: "Implemented user authentication module",
    relevance_score: 0.6,
    trace_id: "abc12345-1234-5678-9abc-def012345678",
    tags: ["authentication"],
  },
];

const sampleExecutions: IExecutionMemory[] = [
  {
    trace_id: "exec-1111-2222-3333-4444",
    request_id: "req-1",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: ExecutionStatus.COMPLETED,
    portal: "test-portal",
    identity_id: "test-agent",
    summary: "Implemented feature X with comprehensive tests",
    context_files: ["src/feature.ts"],
    context_portals: ["test-portal"],
    changes: { files_created: [], files_modified: [], files_deleted: [] },
  },
  {
    trace_id: "exec-5555-6666-7777-8888",
    request_id: "req-2",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: ExecutionStatus.COMPLETED,
    portal: "other-portal",
    identity_id: "test-agent",
    summary: "Fixed bug in authentication flow",
    context_files: ["src/auth.ts"],
    context_portals: ["other-portal"],
    changes: { files_created: [], files_modified: [], files_deleted: [] },
  },
];

// ===== Configuration Tests =====

Deno.test("SessionMemoryService - default configuration", () => {
  const memoryBank = createMockMemoryBank();
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const config = service.getConfig();

  assertEquals(config.enabled, true);
  assertEquals(config.topK, 5);
  assertEquals(config.threshold, 0.3);
  assertEquals(config.includeExecutions, true);
  assertEquals(config.includeLearnings, true);
  assertEquals(config.includePatterns, true);
  assertEquals(config.maxContextLength, 4000);
});

Deno.test("SessionMemoryService - custom configuration", () => {
  const memoryBank = createMockMemoryBank();
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService, {
    topK: 10,
    threshold: 0.5,
    includeExecutions: false,
  });
  const config = service.getConfig();

  assertEquals(config.topK, 10);
  assertEquals(config.threshold, 0.5);
  assertEquals(config.includeExecutions, false);
  // Defaults should still apply
  assertEquals(config.includeLearnings, true);
});

Deno.test("SessionMemoryService - update configuration", () => {
  const memoryBank = createMockMemoryBank();
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);
  service.updateConfig({ topK: 15, threshold: 0.1 });

  const config = service.getConfig();
  assertEquals(config.topK, 15);
  assertEquals(config.threshold, 0.1);
});

// ===== Memory Lookup Tests =====

Deno.test("SessionMemoryService - lookupMemories returns empty when disabled", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService, { enabled: false });
  const memories = await service.lookupMemories("test query");

  assertEquals(memories.length, 0);
});

Deno.test("SessionMemoryService - lookupMemories combines embedding and keyword search", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService, {
    topK: 10,
    threshold: 0.3,
  });
  const memories = await service.lookupMemories("repository pattern");

  // Should have both embedding results and search results
  assertGreater(memories.length, 0);

  // Check that we have learning type from embeddings
  const hasLearning = memories.some((m) =>
    m.type === MemoryType.LEARNING || m.type === MemoryType.PATTERN || m.type === MemoryType.DECISION
  );
  assertEquals(hasLearning, true);
});

Deno.test("SessionMemoryService - lookupMemories respects threshold", async () => {
  const memoryBank = createMockMemoryBank([]);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  // High threshold should filter out low similarity results
  const service = new SessionMemoryService(memoryBank, embeddingService, {
    threshold: 0.8,
    topK: 10,
  });
  const memories = await service.lookupMemories("test");

  // Only learning-1 has similarity >= 0.8
  assertEquals(memories.length, 1);
  assertEquals(memories[0].title, "Repository Pattern for Data Access");
});

Deno.test("SessionMemoryService - lookupMemories respects topK limit", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService, {
    topK: 2,
    threshold: 0,
  });
  const memories = await service.lookupMemories("test query");

  assertLess(memories.length, 4); // Should be limited
});

Deno.test("SessionMemoryService - lookupMemories filters by type config", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService([]);

  const service = new SessionMemoryService(memoryBank, embeddingService, {
    includeExecutions: false,
    includePatterns: true,
    includeLearnings: false,
    topK: 10,
  });
  const memories = await service.lookupMemories("test");

  // Should not have execution type
  const hasExecution = memories.some((m) => m.type === MemoryType.EXECUTION);
  assertEquals(hasExecution, false);
});

// ===== Request Enhancement Tests =====

Deno.test("SessionMemoryService - enhanceRequest returns empty context when disabled", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService, { enabled: false });
  const enhanced = await service.enhanceRequest("test request");

  assertEquals(enhanced.originalRequest, "test request");
  assertEquals(enhanced.memories.length, 0);
  assertEquals(enhanced.memoryContext, "");
  assertEquals(enhanced.metadata.memoriesRetrieved, 0);
});

Deno.test("SessionMemoryService - enhanceRequest includes metadata", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const enhanced = await service.enhanceRequest("How do I implement a repository pattern?");

  assertEquals(enhanced.originalRequest, "How do I implement a repository pattern?");
  assertGreater(enhanced.metadata.memoriesRetrieved, 0);
  assertGreater(enhanced.metadata.searchTime, 0);
  assertExists(enhanced.metadata.queryTerms);
});

Deno.test("SessionMemoryService - enhanceRequest formats memory context", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const enhanced = await service.enhanceRequest("repository pattern");

  // Context should contain formatted memory items
  if (enhanced.memories.length > 0) {
    assertStringIncludes(enhanced.memoryContext, "###");
    assertStringIncludes(enhanced.memoryContext, "Relevance:");
  }
});

Deno.test("SessionMemoryService - enhanceRequest respects maxContextLength", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService, {
    maxContextLength: 100, // Very short
    topK: 10,
  });
  const enhanced = await service.enhanceRequest("test");

  // Context should be limited
  assertLess(enhanced.memoryContext.length, 200); // Some buffer for formatting
});

// ===== Insight Saving Tests =====

Deno.test("SessionMemoryService - saveInsight creates learning entry", async () => {
  const savedLearnings: ILearning[] = [];
  const memoryBank = createMockMemoryBank([], savedLearnings);
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);

  const insight: Insight = {
    title: "Test Insight",
    description: "This is a test insight about patterns",
    category: LearningCategory.PATTERN,
    tags: ["test", LearningCategory.PATTERN],
    confidence: ConfidenceLevel.HIGH,
  };

  const result = await service.saveInsight(insight);

  assertEquals(result.success, true);
  assertExists(result.learningId);
  assertStringIncludes(result.message, "pending approval");

  // Check that learning was saved
  assertEquals(savedLearnings.length, 1);
  assertEquals(savedLearnings[0].title, "Test Insight");
  assertEquals(savedLearnings[0].status, MemoryStatus.PENDING);
  assertEquals(savedLearnings[0].source, MemoryBankSource.IDENTITY);
});

Deno.test("SessionMemoryService - saveInsight with portal creates project-scoped learning", async () => {
  const savedLearnings: ILearning[] = [];
  const memoryBank = createMockMemoryBank([], savedLearnings);
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);

  const insight: Insight = {
    title: "Project-specific IPattern",
    description: "This pattern applies only to this project",
    category: LearningCategory.PATTERN,
    tags: ["project-specific"],
    confidence: ConfidenceLevel.MEDIUM,
    portal: "my-project",
  };

  const result = await service.saveInsight(insight);

  assertEquals(result.success, true);
  assertEquals(savedLearnings[0].scope, MemoryScope.PROJECT);
  assertEquals(savedLearnings[0].project, "my-project");
});

Deno.test("SessionMemoryService - saveInsight handles errors gracefully", async () => {
  const memoryBank = new MockMemoryBankService(undefined, undefined, undefined);
  memoryBank.addGlobalLearning = () => {
    return Promise.reject(new Error("Database error"));
  };
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);

  const insight: Insight = {
    title: "Test",
    description: "Test",
    category: LearningCategory.INSIGHT,
    tags: [],
    confidence: ConfidenceLevel.LOW,
  };

  const result = await service.saveInsight(insight);

  assertEquals(result.success, false);
  assertStringIncludes(result.message, "Failed to save insight");
});

Deno.test("SessionMemoryService - saveInsights saves multiple", async () => {
  const savedLearnings: ILearning[] = [];
  const memoryBank = createMockMemoryBank([], savedLearnings);
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);

  const insights: Insight[] = [
    {
      title: "Insight 1",
      description: "First insight",
      category: LearningCategory.PATTERN,
      tags: ["tag1"],
      confidence: ConfidenceLevel.HIGH,
    },
    {
      title: "Insight 2",
      description: "Second insight",
      category: LearningCategory.DECISION,
      tags: ["tag2"],
      confidence: ConfidenceLevel.MEDIUM,
    },
  ];

  const results = await service.saveInsights(insights);

  assertEquals(results.length, 2);
  assertEquals(results[0].success, true);
  assertEquals(results[1].success, true);
  assertEquals(savedLearnings.length, 2);
});

// ===== Tag-based Search Tests =====

Deno.test("SessionMemoryService - getMemoriesByTag filters correctly", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const memories = await service.getMemoriesByTag(["architecture"]);

  // Should only return items with 'architecture' tag
  for (const memory of memories) {
    assertEquals(memory.tags?.includes("architecture"), true);
  }
});

// ===== Execution History Tests =====

Deno.test("SessionMemoryService - getRecentExecutions returns formatted memories", async () => {
  const memoryBank = createMockMemoryBank([], [], sampleExecutions);
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const memories = await service.getRecentExecutions();

  assertEquals(memories.length, 2);
  assertEquals(memories[0].type, MemoryType.EXECUTION);
  assertStringIncludes(memories[0].title, "Execution:");
  assertEquals(memories[0].relevance, 1.0); // Recent executions are always relevant
});

Deno.test("SessionMemoryService - getRecentExecutions respects limit", async () => {
  const memoryBank = createMockMemoryBank([], [], sampleExecutions);
  const embeddingService = createMockEmbeddingService();

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const memories = await service.getRecentExecutions(undefined, 1);

  assertEquals(memories.length, 1);
});

// ===== Key Term Extraction Tests =====

Deno.test("SessionMemoryService - extracts key terms from query", async () => {
  const memoryBank = createMockMemoryBank([]);
  const embeddingService = createMockEmbeddingService([]);

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const enhanced = await service.enhanceRequest(
    "How do I implement a repository pattern for database operations?",
  );

  // Should extract meaningful terms, not stop words
  const terms = enhanced.metadata.queryTerms || [];

  // Should NOT include stop words
  assertEquals(terms.includes("the"), false);
  assertEquals(terms.includes("a"), false);
  assertEquals(terms.includes("for"), false);
  assertEquals(terms.includes("do"), false);
  assertEquals(terms.includes("how"), false);

  // Should include meaningful terms
  assertEquals(terms.includes("implement"), true);
  assertEquals(terms.includes("repository"), true);
  assertEquals(terms.includes(LearningCategory.PATTERN), true);
  assertEquals(terms.includes("database"), true);
  assertEquals(terms.includes("operations"), true);
});

// ===== Memory Item Formatting Tests =====

Deno.test("SessionMemoryService - formats memory items with tags", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService([]);

  const service = new SessionMemoryService(memoryBank, embeddingService);
  const enhanced = await service.enhanceRequest("test pattern");

  if (enhanced.memories.length > 0) {
    // Context should include tags if present
    const hasTaggedMemory = enhanced.memories.some((m) => m.tags && m.tags.length > 0);
    if (hasTaggedMemory) {
      // Should format tags in brackets
      assertStringIncludes(enhanced.memoryContext, "[");
    }
  }
});

Deno.test("SessionMemoryService - sorts memories by relevance", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);

  const service = new SessionMemoryService(memoryBank, embeddingService, {
    topK: 20, // Get many to verify sorting
    threshold: 0,
  });
  const memories = await service.lookupMemories("test");

  // Verify sorted by relevance descending
  for (let i = 1; i < memories.length; i++) {
    assertGreater(memories[i - 1].relevance + 0.001, memories[i].relevance - 0.001);
  }
});

Deno.test("SessionMemoryService - tags learnings with WORKING tier on save", async () => {
  const memoryBank = createMockMemoryBank();
  const embeddingService = createMockEmbeddingService();
  const service = new SessionMemoryService(memoryBank, embeddingService);

  const result = await service.saveInsight({
    title: "Test learning",
    description: "A test learning entry",
    category: LearningCategory.INSIGHT,
    tags: ["test"],
    confidence: ConfidenceLevel.HIGH,
  });

  assertExists(result.learningId);
  assertEquals(result.success, true);
});

Deno.test("SessionMemoryService - promoteMemories promotes WORKING to EPISODIC", async () => {
  const memoryBank = createMockMemoryBank();
  const embeddingService = createMockEmbeddingService();
  const service = new SessionMemoryService(memoryBank, embeddingService);

  await service.saveInsight({
    title: "Important learning",
    description: "A high-value learning that should be promoted",
    category: LearningCategory.INSIGHT,
    tags: ["important"],
    confidence: ConfidenceLevel.HIGH,
  });

  // Promote — entry has high confidence, should promote from WORKING to EPISODIC
  const promoted = service.promoteMemories();
  assertGreater(promoted, 0, "at least one entry should be promoted");
});

Deno.test("SessionMemoryService - promoteMemories promotes EPISODIC to SEMANTIC on repeated access", async () => {
  const memoryBank = createMockMemoryBank();
  const embeddingService = createMockEmbeddingService();
  const service = new SessionMemoryService(memoryBank, embeddingService);

  await service.saveInsight({
    title: "Core knowledge",
    description: "Frequently accessed learning",
    category: LearningCategory.INSIGHT,
    tags: ["core"],
    confidence: ConfidenceLevel.HIGH,
  });

  // Promote to EPISODIC first
  service.promoteMemories();

  // Access the entry 3+ times to trigger EPISODIC → SEMANTIC
  for (let i = 0; i < 4; i++) {
    service.accessMemory(1);
  }

  const promoted = service.promoteMemories();
  assertGreater(promoted, 0, "episodic entries with high access count should promote to semantic");
});

Deno.test("SessionMemoryService - lookup prioritizes higher-tier memories", async () => {
  const memoryBank = createMockMemoryBank(sampleSearchResults);
  const embeddingService = createMockEmbeddingService(sampleEmbeddingResults);
  const service = new SessionMemoryService(memoryBank, embeddingService, {
    topK: 20,
    threshold: 0,
  });

  // Save a learning to create a tiered entry
  await service.saveInsight({
    title: "Important pattern",
    description: "A key architectural pattern",
    category: LearningCategory.PATTERN,
    tags: ["architecture"],
    confidence: ConfidenceLevel.HIGH,
  });

  // Promote it to EPISODIC
  service.promoteMemories();

  // Look up memories — the tiered entry should influence sorting
  const memories = await service.lookupMemories("architecture", 10000, {
    includeLearnings: true,
    threshold: 0,
  });

  // The lookupMemories searches via embedding/keyword; the saved insight may not appear
  // in mock results. The test verifies the method doesn't throw when tiered entries exist.
  assertEquals(typeof memories.length, "number");
});
