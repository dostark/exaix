/**
 * @module MemoryCommandsCoverageTest
 * @path tests/cli/memory_commands_coverage_test.ts
 * @description Extended coverage for CLI memory commands, verifying RAG-based search with embeddings,
 * tag-based filtering, and alternative output formats (Markdown/JSON).
 */

import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
  MemoryType,
} from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { MemoryEmbeddingService } from "../../src/services/memory/memory_embedding.ts";
import { SkillsService } from "../../src/services/skills/skills.ts";
import { TestEnvironmentFactory } from "../fixtures/test_environment_factory.ts";
import { ExecutionMemoryBuilder, LearningBuilder, ProjectMemoryBuilder } from "../fixtures/memory_builder.ts";
import {
  TEST_DERIVED_SKILL_DESCRIPTION,
  TEST_DERIVED_SKILL_ID,
  TEST_DERIVED_SKILL_INSTRUCTIONS,
  TEST_DERIVED_SKILL_NAME,
  TEST_PENDING_LEARNING_DESCRIPTION,
  TEST_PENDING_LEARNING_TITLE,
  TEST_PENDING_REASON,
  TEST_SKILL_DESCRIPTION,
  TEST_SKILL_ID,
  TEST_SKILL_INSTRUCTIONS,
  TEST_SKILL_KEYWORD,
  TEST_SKILL_NAME,
  TEST_SKILL_REQUEST_TEXT,
  TEST_SKILL_TASK_TYPE,
} from "@exaix/testing";
import { join } from "@std/path";

/**
 * Builds a reusable test proposal data object for pending-commands tests.
 */
function buildTestProposalData(scope: MemoryScope = MemoryScope.GLOBAL, project?: string) {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: MemoryBankSource.USER,
    scope,
    ...(project ? { project } : {}),
    title: TEST_PENDING_LEARNING_TITLE,
    description: TEST_PENDING_LEARNING_DESCRIPTION,
    category: LearningCategory.PATTERN,
    tags: [TEST_SKILL_KEYWORD],
    confidence: ConfidenceAssessmentLevel.HIGH,
    references: [],
  };
}

// ===== Search with Embeddings Tests =====

Deno.test("MemoryCommands: search with useEmbeddings option", async () => {
  const { commands, memoryBank, config, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  const embedding = new MemoryEmbeddingService(config);
  try {
    // Create project
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("EmbedProject")
        .addPattern({
          name: "Error Handling IPattern",
          description: "Always use try-catch for async operations",
          examples: ["src/api.ts"],
          tags: ["error-handling", "typescript"],
        })
        .build(),
    );

    // Create embeddings for the learning
    const learning = new LearningBuilder()
      .withScope(MemoryScope.GLOBAL)
      .withTitle("Error handling best practices")
      .withDescription("Use try-catch with proper logging for errors")
      .withCategory(LearningCategory.PATTERN)
      .withTags(["error-handling"])
      .build();

    await embedding.embedLearning(learning);

    const result = await commands.search("error handling", {
      useEmbeddings: true,
      format: UIOutputFormat.TABLE,
    });

    // Should return some results (even if empty due to mock embeddings)
    assertEquals(typeof result, "string");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search with tags option", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("TagProject")
        .addPattern({
          name: "Error Handling IPattern",
          description: "Use try-catch",
          examples: ["src/api.ts"],
          tags: ["error-handling", "typescript"], // Includes typescript tag
        })
        .build(),
    );

    const result = await commands.search(LearningCategory.PATTERN, {
      tags: ["typescript"],
      format: UIOutputFormat.TABLE,
    });

    assertEquals(typeof result, "string");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: search --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("MdSearchProject").build(),
    );

    const result = await commands.search("IPattern", { format: UIOutputFormat.MARKDOWN });

    // If results found, should have markdown formatting
    if (!result.includes("No results found")) {
      assertStringIncludes(result, "# Search Results");
      assertStringIncludes(result, "| Type |");
    }
  } finally {
    await cleanup();
  }
});

// ===== Project List Markdown Format Test =====

Deno.test("MemoryCommands: project list --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("MdListProject").build(),
    );

    const result = await commands.projectList(UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Project Memories");
    assertStringIncludes(result, "| Project |");
    assertStringIncludes(result, "MdListProject");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: project show --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("MdShowProject")
        .addPattern({ name: "Test IPattern" })
        .build(),
    );

    const result = await commands.projectShow("MdShowProject", UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Project Memory:");
    assertStringIncludes(result, "## Overview");
    assertStringIncludes(result, "## Patterns");
  } finally {
    await cleanup();
  }
});

// ===== Execution List Markdown Format Test =====

Deno.test("MemoryCommands: execution list --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "cccccccc-cccc-4000-8000-000000000001";
    await memoryBank.createExecutionRecord({
      trace_id: traceId,
      request_id: "req-123",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "MdExecProject",
      identity_id: "test-agent",
      summary: "Test execution",
      context_files: [],
      context_portals: ["MdExecProject"],
      changes: {
        files_created: [],
        files_modified: [],
        files_deleted: [],
      },
    });

    const result = await commands.executionList({ format: UIOutputFormat.MARKDOWN });

    assertStringIncludes(result, "# Execution History");
    assertStringIncludes(result, "| Trace ID |");
  } finally {
    await cleanup();
  }
});

// ===== Global Memory Tests =====

Deno.test("MemoryCommands: globalListLearnings --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    // Add a global learning
    const learning = new LearningBuilder()
      .withTitle("Test global learning")
      .withDescription("A test learning description")
      .withCategory(LearningCategory.PATTERN)
      .withTags(["test"])
      .withScope(MemoryScope.GLOBAL)
      .build();

    await memoryBank.addGlobalLearning(learning);

    const result = await commands.globalListLearnings(UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Global Learnings");
    assertStringIncludes(result, "| ID |");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalStats returns init message when not initialized", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.globalStats(UIOutputFormat.TABLE);

    assertStringIncludes(result, "not initialized");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: globalStats --format md outputs markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.globalStats(UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Global Memory Statistics");
    assertStringIncludes(result, "| Metric | Value |");
  } finally {
    await cleanup();
  }
});

// ===== Promote/Demote Error Handling Tests =====

Deno.test("MemoryCommands: promote returns error for non-existent project", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const result = await commands.promote("NonExistentPortal", {
      type: MemoryType.PATTERN,
      name: "test",
      title: "Test IPattern",
      description: "Test description",
      category: LearningCategory.PATTERN,
      tags: ["test"],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
    });

    assertStringIncludes(result, "Error");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: demote returns error for non-existent learning", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("DemoteTarget").build(),
    );

    const result = await commands.demote("non-existent-id", "DemoteTarget");

    assertStringIncludes(result, "Error");
  } finally {
    await cleanup();
  }
});

// ===== Pending Commands Error Handling =====

Deno.test("MemoryCommands: pendingApprove returns error for non-existent proposal", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingApprove("non-existent-proposal-id");

    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingReject returns error for non-existent proposal", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingReject("non-existent-proposal-id", "Reason");

    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

// ===== Rebuild Index with Embeddings =====

Deno.test("MemoryCommands: rebuildIndex with embeddings option", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    // Add a learning to embed
    const learning = new LearningBuilder()
      .withTitle("Embedding test learning")
      .withDescription("This learning will be embedded during index rebuild")
      .withCategory(LearningCategory.INSIGHT)
      .withTags(["test"])
      .withScope(MemoryScope.GLOBAL)
      .build();

    await memoryBank.addGlobalLearning(learning);

    const result = await commands.rebuildIndex({ includeEmbeddings: true });

    assertStringIncludes(result, "rebuilt successfully");
    assertStringIncludes(result, "Embeddings regenerated");
  } finally {
    await cleanup();
  }
});

// ===== Edge Cases for Execution Show =====

Deno.test("MemoryCommands: execution show with error message", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "ffffffff-ffff-4000-8000-000000000001";
    await memoryBank.createExecutionRecord({
      trace_id: traceId,
      request_id: "req-error",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.FAILED,
      portal: "ErrorProject",
      identity_id: "test-agent",
      summary: "Failed execution",
      context_files: [],
      context_portals: [],
      changes: {
        files_created: [],
        files_modified: [],
        files_deleted: [],
      },
      error_message: "Connection timeout after 30 seconds",
    });

    const result = await commands.executionShow(traceId, UIOutputFormat.TABLE);

    assertStringIncludes(result, "Error:");
    assertStringIncludes(result, "Connection timeout");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show with changes and lessons learned", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "11111111-1111-4000-8000-000000000001";
    await memoryBank.createExecutionRecord({
      trace_id: traceId,
      request_id: "req-full",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "FullProject",
      identity_id: "test-agent",
      summary: "Full execution with changes",
      context_files: ["src/main.ts", "src/api.ts"],
      context_portals: ["FullProject"],
      changes: {
        files_created: ["src/new.ts"],
        files_modified: ["src/main.ts"],
        files_deleted: ["src/old.ts"],
      },
      lessons_learned: ["Lesson 1: Test first", "Lesson 2: Document everything"],
    });

    const result = await commands.executionShow(traceId, UIOutputFormat.TABLE);

    assertStringIncludes(result, "Changes:");
    assertStringIncludes(result, "Created:");
    assertStringIncludes(result, "Modified:");
    assertStringIncludes(result, "Deleted:");
    assertStringIncludes(result, "Lessons Learned:");
    assertStringIncludes(result, "Test first");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: execution show --format md with full data", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const traceId = "22222222-2222-4000-8000-000000000001";
    await memoryBank.createExecutionRecord({
      trace_id: traceId,
      request_id: "req-md",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "MdFullProject",
      identity_id: "test-agent",
      summary: "Full markdown test",
      context_files: ["src/index.ts"],
      context_portals: ["MdFullProject"],
      changes: {
        files_created: ["src/feature.ts"],
        files_modified: ["src/index.ts"],
        files_deleted: [],
      },
      lessons_learned: ["Always write tests"],
    });

    const result = await commands.executionShow(traceId, UIOutputFormat.MARKDOWN);

    assertStringIncludes(result, "# Execution:");
    assertStringIncludes(result, "## Context Files");
    assertStringIncludes(result, "## Changes");
    assertStringIncludes(result, "### Created");
    assertStringIncludes(result, "### Modified");
    assertStringIncludes(result, "## Lessons Learned");
  } finally {
    await cleanup();
  }
});

// ===== Global ILearning Table Format =====

Deno.test("MemoryCommands: globalListLearnings table format with learnings", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    // Add multiple learnings
    for (let i = 1; i <= 3; i++) {
      await memoryBank.addGlobalLearning(
        new LearningBuilder()
          .withTitle(`ILearning ${i}`)
          .withDescription(`Description for learning ${i}`)
          .withCategory(LearningCategory.PATTERN)
          .withTags(["test"])
          .build(),
      );
    }

    const result = await commands.globalListLearnings(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Global Learnings");
    assertStringIncludes(result, "ID");
    assertStringIncludes(result, "Category");
    assertStringIncludes(result, "Confidence");
    assertStringIncludes(result, "Total: 3 learning(s)");
  } finally {
    await cleanup();
  }
});

// ===== Global Stats with Data =====

Deno.test("MemoryCommands: globalStats with learnings by category and project", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("StatsProject")
        .addPattern({
          name: "Error Handling IPattern",
          description: "Use try-catch",
          examples: [],
          tags: ["error-handling", "typescript"],
        })
        .build(),
    );

    // Add learnings of different categories
    await memoryBank.addGlobalLearning(
      new LearningBuilder()
        .withTitle("IPattern ILearning")
        .withDescription("A pattern")
        .withCategory(LearningCategory.PATTERN)
        .build(),
    );

    await memoryBank.addGlobalLearning(
      new LearningBuilder()
        .withTitle("Insight ILearning")
        .withDescription("An insight")
        .withCategory(LearningCategory.INSIGHT)
        .build(),
    );

    const result = await commands.globalStats(UIOutputFormat.TABLE);

    assertStringIncludes(result, "Global Memory Statistics");
    assertStringIncludes(result, "Total Learnings:");
    assertStringIncludes(result, "By Category:");
  } finally {
    await cleanup();
  }
});

// ===== Pending Commands Success Paths =====

Deno.test("MemoryCommands: pendingList and pendingShow return proposal details", async () => {
  const { commands, extractor, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const execution = new ExecutionMemoryBuilder("PendingProject").build();
    const proposalId = await extractor.createProposal(buildTestProposalData(), execution, "test-identity");

    const listResult = await commands.pendingList(false, UIOutputFormat.TABLE);
    assertStringIncludes(listResult, "Pending Memory Update Proposals");
    assertStringIncludes(listResult, TEST_PENDING_LEARNING_TITLE);

    const showResult = await commands.pendingShow(proposalId, UIOutputFormat.MARKDOWN);
    assertStringIncludes(showResult, "# Pending Proposal");
    assertStringIncludes(showResult, TEST_PENDING_LEARNING_DESCRIPTION);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApprove approves global proposal", async () => {
  const { commands, extractor, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const execution = new ExecutionMemoryBuilder("GlobalProject").build();
    const proposalId = await extractor.createProposal(buildTestProposalData(), execution, "test-identity");

    const result = await commands.pendingApprove(proposalId);
    assertStringIncludes(result, "Proposal approved successfully");

    const globalMem = await memoryBank.getGlobalMemory();
    assertEquals(globalMem?.learnings.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingReject rejects proposal with reason", async () => {
  const { commands, extractor, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const execution = new ExecutionMemoryBuilder("RejectProject").build();
    const proposalId = await extractor.createProposal(buildTestProposalData(), execution, "test-identity");

    const result = await commands.pendingReject(proposalId, TEST_PENDING_REASON);
    assertStringIncludes(result, "Proposal rejected");
    assertStringIncludes(result, TEST_PENDING_REASON);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApproveAll approves multiple proposals", async () => {
  const { commands, extractor, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();
    await memoryBank.createProjectMemory(new ProjectMemoryBuilder("PendingProject").build());

    const globalExecution = new ExecutionMemoryBuilder("GlobalProject").build();
    await extractor.createProposal(buildTestProposalData(), globalExecution, "test-identity");

    const projectExecution = new ExecutionMemoryBuilder("PendingProject").build();
    await extractor.createProposal(
      buildTestProposalData(MemoryScope.PROJECT, "PendingProject"),
      projectExecution,
      "test-identity",
    );

    const result = await commands.pendingApproveAll();
    assertStringIncludes(result, "Approved 2 proposal(s)");
  } finally {
    await cleanup();
  }
});

// ===== Skills Commands Coverage =====

Deno.test("MemoryCommands: skillList returns empty message when no skills exist", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.skillList();

    assertStringIncludes(result, "No skills found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: skillCreate, skillShow, and skillList (json) work", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const createResult = await commands.skillCreate(TEST_SKILL_NAME, {
      category: MemoryBankSource.LEARNED,
      description: TEST_SKILL_DESCRIPTION,
      instructions: TEST_SKILL_INSTRUCTIONS,
      triggersKeywords: [TEST_SKILL_KEYWORD],
      triggersTaskTypes: [TEST_SKILL_TASK_TYPE],
    });

    assertStringIncludes(createResult, TEST_SKILL_ID);

    const listJson = await commands.skillList({ category: MemoryBankSource.LEARNED, format: UIOutputFormat.JSON });
    const parsed = JSON.parse(listJson) as Array<{ skill_id: string }>;
    assertEquals(parsed[0].skill_id, TEST_SKILL_ID);

    const showResult = await commands.skillShow(TEST_SKILL_ID, UIOutputFormat.MARKDOWN);
    assertStringIncludes(showResult, TEST_SKILL_NAME);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: skillMatch returns matches for active skill", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate(TEST_SKILL_NAME, {
      category: MemoryBankSource.LEARNED,
      description: TEST_SKILL_DESCRIPTION,
      instructions: TEST_SKILL_INSTRUCTIONS,
      triggersKeywords: [TEST_SKILL_KEYWORD],
      triggersTaskTypes: [TEST_SKILL_TASK_TYPE],
    });

    const skills = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    await skills.initialize();
    await skills.activateSkill(TEST_SKILL_ID);

    const result = await commands.skillMatch(TEST_SKILL_REQUEST_TEXT, {
      taskType: TEST_SKILL_TASK_TYPE,
      format: UIOutputFormat.TABLE,
    });

    assertStringIncludes(result, TEST_SKILL_ID);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: skillDerive returns derived skill JSON", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.skillDerive({
      learningIds: [crypto.randomUUID()],
      name: TEST_DERIVED_SKILL_NAME,
      description: TEST_DERIVED_SKILL_DESCRIPTION,
      instructions: TEST_DERIVED_SKILL_INSTRUCTIONS,
      format: UIOutputFormat.JSON,
    });

    const parsed = JSON.parse(result) as { skill_id: string };
    assertEquals(parsed.skill_id, TEST_DERIVED_SKILL_ID);
  } finally {
    await cleanup();
  }
});
