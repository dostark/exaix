/**
 * @module MemoryPipelineIntegrationTest
 * @path tests/integration/memory_test.ts
 * @description Verifies the end-to-end memory pipeline, from learning extraction during
 * execution to interactive approval and promote/search workflows.
 */

import {
  ConfidenceAssessmentLevel,
  EvaluationCategory,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import { MemoryStatus } from "@exaix/core/status";

import { assertEquals, assertExists, assertGreaterOrEqual, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { MemoryBankService } from "@exaix/memory";
import { MemoryExtractorService } from "@exaix/memory";
import { MemoryEmbeddingService } from "@exaix/memory";
import { MemoryCommands } from "../../apps/exactl/src/commands/memory_commands.ts";
import { MemoryBankAdapter, MemoryEmbeddingAdapter, MemoryExtractorAdapter } from "../../apps/common/adapters/mod.ts";
import { initTestDbService } from "@exaix/testing";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import type { IExecutionMemory, ILearning, IProjectMemory } from "@exaix/schemas/memory_bank.ts";
import { getMemoryGlobalDir } from "@exaix/testing";

// Full Workflow Tests

Deno.test("Integration: full workflow - execution → extract → approve → search", async () => {
  const { config, db, cleanup } = await initTestDbService();

  try {
    const memoryBank = new MemoryBankService(config);
    const extractor = new MemoryExtractorService(config, db, memoryBank);
    const _embedding = new MemoryEmbeddingService(config);

    const projectMem: IProjectMemory = {
      portal: "integration-test-portal",
      overview: "Integration test project",
      patterns: [],
      decisions: [],
      references: [],
    };
    await memoryBank.createProjectMemory(projectMem);

    const execution: IExecutionMemory = {
      trace_id: "dddddddd-4444-4000-8000-000000000001",
      request_id: "REQ-INT-001",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "integration-test-portal",
      identity_id: "test-agent",
      summary: "Implemented error handling middleware with proper async/await patterns",
      context_files: ["src/middleware/error.ts"],
      context_portals: ["integration-test-portal"],
      changes: {
        files_created: ["src/middleware/error.ts"],
        files_modified: ["src/app.ts"],
        files_deleted: [],
      },
      lessons_learned: ["Always use try-catch for async middleware"],
    };
    await memoryBank.createExecutionRecord(execution);

    const extractedLearnings = await extractor.analyzeExecution(execution);
    assertGreaterOrEqual(extractedLearnings.length, 1);

    const proposalId = await extractor.createProposal(extractedLearnings[0], execution, "test-identity");
    assertExists(proposalId);

    const pending = await extractor.listPending();
    assertGreaterOrEqual(pending.length, 1);

    await extractor.approvePending(proposalId);

    // When scope is MemoryScope.PROJECT, approval adds as pattern, not global learning
    const updatedProjectMem = await memoryBank.getProjectMemory("integration-test-portal");
    assertExists(updatedProjectMem);
    assertGreaterOrEqual(updatedProjectMem.patterns.length, 1);

    const searchResults = await memoryBank.searchByKeyword("try-catch");
    assertGreaterOrEqual(searchResults.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("Integration: execution failure extracts troubleshooting learning", async () => {
  const { config, db, cleanup } = await initTestDbService();

  try {
    const memoryBank = new MemoryBankService(config);
    const extractor = new MemoryExtractorService(config, db, memoryBank);

    // Create project
    await memoryBank.createProjectMemory({
      portal: "failure-test-portal",
      overview: "Test portal for failure handling",
      patterns: [],
      decisions: [],
      references: [],
    });

    // Create failed execution
    const execution: IExecutionMemory = {
      trace_id: "eeeeeeee-5555-4000-8000-000000000001",
      request_id: "REQ-FAIL-001",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.FAILED,
      portal: "failure-test-portal",
      identity_id: "test-agent",
      summary: "Failed to parse configuration file",
      context_files: ["config.json"],
      context_portals: ["failure-test-portal"],
      changes: {
        files_created: [],
        files_modified: [],
        files_deleted: [],
      },
      error_message: "Invalid JSON: Unexpected token at position 42",
    };
    await memoryBank.createExecutionRecord(execution);

    // Extract learnings from failure using analyzeExecution
    const learnings = await extractor.analyzeExecution(execution);

    // Should extract troubleshooting learning
    assertGreaterOrEqual(learnings.length, 1);
    const learning = learnings[0];
    assertEquals(learning.category, "troubleshooting");
    assertStringIncludes(learning.description.toLowerCase(), UIOutputFormat.JSON);
  } finally {
    await cleanup();
  }
});

Deno.test("Integration: promote workflow - project → global", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const memoryBank = new MemoryBankService(config);

    // Create project with a pattern
    await memoryBank.createProjectMemory({
      portal: "promote-test-portal",
      overview: "Test portal for promotion",
      patterns: [
        {
          name: "Singleton IPattern",
          description: "Ensures only one instance of a class exists",
          examples: ["src/config.ts"],
          tags: ["creational", "design-pattern"],
        },
      ],
      decisions: [],
      references: [],
    });

    // Promote learning to global
    const learning: ILearning = {
      id: "ffffffff-6666-4000-8000-000000000001",
      created_at: new Date().toISOString(),
      source: MemoryBankSource.USER,
      scope: MemoryScope.GLOBAL,
      title: "Singleton IPattern Best Practice",
      description: "Use lazy initialization for singletons to avoid startup overhead",
      category: LearningCategory.PATTERN,
      tags: ["singleton", "design-pattern", EvaluationCategory.PERFORMANCE],
      confidence: ConfidenceAssessmentLevel.HIGH,
      status: MemoryStatus.APPROVED,
    };

    await memoryBank.addGlobalLearning(learning);

    // Verify global learning exists
    const searchResults = await memoryBank.searchByTags(["singleton"]);
    assertGreaterOrEqual(searchResults.length, 1);
    assertEquals(searchResults[0].title, "Singleton IPattern Best Practice");
  } finally {
    await cleanup();
  }
});

// Search Workflow Tests

Deno.test("Integration: search workflow - tag + keyword + embedding combined", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const memoryBank = new MemoryBankService(config);
    const embedding = new MemoryEmbeddingService(config);

    // Create diverse test data
    await memoryBank.createProjectMemory({
      portal: "search-workflow-portal",
      overview: "A project focused on database optimization",
      patterns: [
        {
          name: "Connection Pooling",
          description: "Reuse database connections for better performance",
          examples: ["src/db/pool.ts"],
          tags: ["database", EvaluationCategory.PERFORMANCE, "optimization"],
        },
        {
          name: "Query Builder",
          description: "Build SQL queries programmatically",
          examples: ["src/db/query.ts"],
          tags: ["database", "sql", "architecture"],
        },
      ],
      decisions: [
        {
          date: "2026-01-04",
          decision: "Use connection pooling",
          rationale: "Reduce connection overhead",
          tags: ["database", EvaluationCategory.PERFORMANCE],
        },
      ],
      references: [],
    });

    // Add global learnings
    const learnings: ILearning[] = [
      {
        id: "11111111-aaaa-4000-8000-000000000001",
        created_at: new Date().toISOString(),
        source: MemoryBankSource.IDENTITY,
        scope: MemoryScope.GLOBAL,
        title: "Database indexing strategy",
        description: "Create indexes on frequently queried columns for optimal database performance",
        category: LearningCategory.INSIGHT,
        tags: ["database", EvaluationCategory.PERFORMANCE, "indexing"],
        confidence: ConfidenceAssessmentLevel.HIGH,
        status: MemoryStatus.APPROVED,
      },
      {
        id: "11111111-aaaa-4000-8000-000000000002",
        created_at: new Date().toISOString(),
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        title: "Error logging best practice",
        description: "Always log errors with stack traces and context for debugging",
        category: LearningCategory.PATTERN,
        tags: ["error-handling", "logging", "debugging"],
        confidence: ConfidenceAssessmentLevel.HIGH,
        status: MemoryStatus.APPROVED,
      },
    ];

    const globalDir = getMemoryGlobalDir(config.system.root);
    await Deno.mkdir(globalDir, { recursive: true });
    await Deno.writeTextFile(
      join(globalDir, "learnings.json"),
      JSON.stringify(learnings, null, 2),
    );

    // Initialize embedding manifest and embed learnings
    await embedding.initializeManifest();
    for (const learning of learnings) {
      await embedding.embedLearning(learning);
    }

    // Test tag-based search
    const tagResults = await memoryBank.searchByTags(["database"]);
    assertGreaterOrEqual(tagResults.length, 2);

    // Test keyword search
    const keywordResults = await memoryBank.searchByKeyword(EvaluationCategory.PERFORMANCE);
    assertGreaterOrEqual(keywordResults.length, 2);

    // Test combined search
    const combinedResults = await memoryBank.searchMemoryAdvanced({
      tags: ["database"],
      keyword: EvaluationCategory.PERFORMANCE,
    });
    assertGreaterOrEqual(combinedResults.length, 1);

    // Test embedding search with lower threshold for mock embeddings
    // Mock embeddings may not achieve high similarity, so we use threshold 0
    const embeddingResults = await embedding.searchByEmbedding("database indexing", { threshold: 0, limit: 20 });
    // With threshold 0, we should get all embeddings back
    assertGreaterOrEqual(embeddingResults.length, 1);
  } finally {
    await cleanup();
  }
});

// CLI Workflow Tests

Deno.test("Integration: CLI workflow - complete command sequence", async () => {
  const { config, db, cleanup } = await initTestDbService();

  try {
    const context: ICliApplicationContext = {
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(db),
    };
    const memoryBank = new MemoryBankService(config);
    const extractor = new MemoryExtractorService(config, db, memoryBank);
    const embedding = new MemoryEmbeddingService(config);
    context.memoryBank = new MemoryBankAdapter(memoryBank);
    context.extractor = new MemoryExtractorAdapter(extractor);
    context.embeddings = new MemoryEmbeddingAdapter(embedding);
    const commands = new MemoryCommands(context);

    // List (should be empty or minimal)
    const listResult = await commands.list(UIOutputFormat.TABLE);
    assertExists(listResult);

    // Create project memory via service (simulating real usage)
    await memoryBank.createProjectMemory({
      portal: "cli-test-portal",
      overview: "CLI integration test project",
      patterns: [
        {
          name: "Factory IPattern",
          description: "Object creation through factory methods",
          examples: ["src/factories/user.ts"],
          tags: ["creational", "design-pattern"],
        },
      ],
      decisions: [],
      references: [],
    });

    const projectListResult = await commands.projectList(UIOutputFormat.TABLE);
    assertStringIncludes(projectListResult, "cli-test-portal");

    const projectShowResult = await commands.projectShow("cli-test-portal", UIOutputFormat.TABLE);
    assertStringIncludes(projectShowResult, "Factory IPattern");

    const searchResult = await commands.search("factory", { format: UIOutputFormat.TABLE });
    assertStringIncludes(searchResult, "Factory");

    const rebuildResult = await commands.rebuildIndex();
    assertStringIncludes(rebuildResult, "rebuilt");
  } finally {
    await cleanup();
  }
});

Deno.test("Integration: CLI pending workflow - list → approve → verify", async () => {
  const { config, db, cleanup } = await initTestDbService();

  try {
    const context: ICliApplicationContext = {
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(db),
    };
    const memoryBank = new MemoryBankService(config);
    const extractor = new MemoryExtractorService(config, db, memoryBank);
    context.memoryBank = new MemoryBankAdapter(memoryBank);
    context.extractor = new MemoryExtractorAdapter(extractor);
    const commands = new MemoryCommands(context);

    // Create test data
    await memoryBank.createProjectMemory({
      portal: "pending-cli-portal",
      overview: "Pending CLI test",
      patterns: [],
      decisions: [],
      references: [],
    });

    const execution: IExecutionMemory = {
      trace_id: "22222222-bbbb-4000-8000-000000000001",
      request_id: "REQ-CLI-001",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "pending-cli-portal",
      identity_id: "test-agent",
      summary: "Added validation middleware",
      context_files: ["src/validate.ts"],
      context_portals: ["pending-cli-portal"],
      changes: {
        files_created: ["src/validate.ts"],
        files_modified: [],
        files_deleted: [],
      },
      lessons_learned: ["Input validation should happen at API boundaries"],
    };
    await memoryBank.createExecutionRecord(execution);

    // Extract learnings and create proposal
    const learnings = await extractor.analyzeExecution(execution);
    assertGreaterOrEqual(learnings.length, 1);
    await extractor.createProposal(learnings[0], execution, execution.identity_id);

    // List pending via CLI
    const pendingList = await commands.pendingList(false, UIOutputFormat.TABLE);
    assertStringIncludes(pendingList, MemoryStatus.PENDING);

    // Get the proposal ID
    const pending = await extractor.listPending();
    assertGreaterOrEqual(pending.length, 1);
    const proposalId = pending[0].id;

    // Approve via CLI
    const approveResult = await commands.pendingApprove(proposalId);
    assertStringIncludes(approveResult, MemoryStatus.APPROVED);

    // Verify no more pending
    const emptyPending = await extractor.listPending();
    assertEquals(emptyPending.length, 0);
  } finally {
    await cleanup();
  }
});

// Performance Tests

Deno.test("Integration: performance - search completes under 100ms", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const memoryBank = new MemoryBankService(config);

    // Create some test data
    await memoryBank.createProjectMemory({
      portal: "perf-test-portal",
      overview: "Performance test project with various patterns",
      patterns: Array.from({ length: 20 }, (_, i) => ({
        name: `IPattern ${i}`,
        description: `Description for pattern ${i} with some searchable text`,
        examples: [`src/pattern${i}.ts`],
        tags: ["test", `tag${i % 5}`],
      })),
      decisions: Array.from({ length: 10 }, (_, i) => ({
        date: `2026-01-0${(i % 9) + 1}`,
        decision: `IDecision ${i}`,
        rationale: `Rationale for decision ${i}`,
        tags: [LearningCategory.DECISION, `tag${i % 3}`],
      })),
      references: [],
    });

    // Measure search time
    const startTime = performance.now();
    await memoryBank.searchMemory(LearningCategory.PATTERN);
    const searchTime = performance.now() - startTime;

    // Search should complete in under 100ms
    assertGreaterOrEqual(100, searchTime, `Search took ${searchTime}ms, expected < 100ms`);
  } finally {
    await cleanup();
  }
});

Deno.test("Integration: performance - embedding search completes under 500ms", async () => {
  const { db: _db, config, cleanup } = await initTestDbService();

  try {
    const embedding = new MemoryEmbeddingService(config);

    // Create and embed some learnings
    const learnings: ILearning[] = Array.from({ length: 20 }, (_, i) => ({
      id: `33333333-cccc-4000-8000-00000000000${i.toString().padStart(2, "0")}`,
      created_at: new Date().toISOString(),
      source: MemoryBankSource.IDENTITY,
      scope: MemoryScope.GLOBAL,
      title: `ILearning ${i}`,
      description: `Description for learning ${i} with some searchable content`,
      category: LearningCategory.INSIGHT,
      tags: [`tag${i % 5}`],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      status: MemoryStatus.APPROVED,
    }));

    for (const learning of learnings) {
      await embedding.embedLearning(learning);
    }

    // Measure embedding search time
    const startTime = performance.now();
    await embedding.searchByEmbedding("searchable content");
    const searchTime = performance.now() - startTime;

    // Embedding search should complete in under 500ms
    assertGreaterOrEqual(500, searchTime, `Embedding search took ${searchTime}ms, expected < 500ms`);
  } finally {
    await cleanup();
  }
});
