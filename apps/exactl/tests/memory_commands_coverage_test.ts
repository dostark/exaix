/**
 * @module MemoryCommandsCoverageTest
 * @path apps/exactl/tests/memory_commands_coverage_test.ts
 * @related-files []
 * @architectural-layer CLI
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
  SkillStatus,
} from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { MemoryEmbeddingService } from "@exaix/memory";
import { SkillsService } from "@exaix/core/skills";
import { TestEnvironmentFactory } from "../../../tests/fixtures/test_environment_factory.ts";
import {
  ExecutionMemoryBuilder,
  LearningBuilder,
  ProjectMemoryBuilder,
} from "../../../tests/fixtures/memory_builder.ts";
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
  testSkillContext,
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

// Search with Embeddings Tests

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
    });

    // Should return some results (even if empty due to mock embeddings)
    assertEquals(Array.isArray(result), true);
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
    });

    assertEquals(Array.isArray(result), true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryFormatter: search results render as markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("MdSearchProject").build(),
    );

    const results = await commands.search("IPattern");
    const markdown = new MemoryFormatter().formatSearchMarkdown("IPattern", results);

    // If results found, should have markdown formatting
    if (results.length > 0) {
      assertStringIncludes(markdown, "# Search Results");
      assertStringIncludes(markdown, "| Type |");
    }
  } finally {
    await cleanup();
  }
});

// Project List Markdown Format Test

Deno.test("MemoryFormatter: the project list renders as markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("MdListProject").build(),
    );

    const result = new MemoryFormatter().formatProjectListMarkdown(await commands.projectList());

    assertStringIncludes(result, "# Project Memories");
    assertStringIncludes(result, "| Project |");
    assertStringIncludes(result, "MdListProject");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryFormatter: a project renders as markdown", async () => {
  const { commands, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.createProjectMemory(
      new ProjectMemoryBuilder("MdShowProject")
        .addPattern({ name: "Test IPattern" })
        .build(),
    );

    const result = new MemoryFormatter().formatProjectShowMarkdown(await commands.projectShow("MdShowProject"));

    assertStringIncludes(result, "# Project Memory:");
    assertStringIncludes(result, "## Overview");
    assertStringIncludes(result, "## Patterns");
  } finally {
    await cleanup();
  }
});

// Execution List Markdown Format Test

Deno.test("MemoryFormatter: the execution list renders as markdown", async () => {
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
      agent_role: "test-agent",
      summary: "Test execution",
      context_files: [],
      context_portals: ["MdExecProject"],
      changes: {
        files_created: [],
        files_modified: [],
        files_deleted: [],
      },
    });

    const result = new MemoryFormatter().formatExecutionListMarkdown(await commands.executionList());

    assertStringIncludes(result, "# Execution History");
    assertStringIncludes(result, "| Trace ID |");
  } finally {
    await cleanup();
  }
});

// Global Memory Tests

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

// Promote/Demote Error Handling Tests

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

// Pending Commands Error Handling

Deno.test("MemoryCommands: pendingApprove returns error for non-existent proposal", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => commands.pendingApprove("non-existent-proposal-id"), ExaCtlError);

    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
    assertStringIncludes(error.message, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingReject returns error for non-existent proposal", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => commands.pendingReject("non-existent-proposal-id", "Reason"), ExaCtlError);

    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
    assertStringIncludes(error.message, "not found");
  } finally {
    await cleanup();
  }
});

// Rebuild Index with Embeddings

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

    assertEquals(result.embeddings, 1);
  } finally {
    await cleanup();
  }
});

// Edge Cases for Execution Show

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
      agent_role: "test-agent",
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

    const result = new MemoryFormatter().formatExecutionShowTable(await commands.executionShow(traceId));

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
      agent_role: "test-agent",
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

    const result = new MemoryFormatter().formatExecutionShowTable(await commands.executionShow(traceId));

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

Deno.test("MemoryFormatter: an execution with full data renders as markdown", async () => {
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
      agent_role: "test-agent",
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

    const result = new MemoryFormatter().formatExecutionShowMarkdown(await commands.executionShow(traceId));

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

// Global ILearning Table Format

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

// Global Stats with Data

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

// Pending Commands Success Paths

Deno.test("MemoryCommands: pendingList and pendingShow return proposal details", async () => {
  const { commands, extractor, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const execution = new ExecutionMemoryBuilder("PendingProject").build();
    const proposalId = await extractor.createProposal(buildTestProposalData(), execution, "test-role");

    const listResult = await commands.pendingList(false);
    assertEquals(listResult.map((proposal) => proposal.learning.title), [TEST_PENDING_LEARNING_TITLE]);

    const showResult = await commands.pendingShow(proposalId);
    assertEquals(showResult.learning.description, TEST_PENDING_LEARNING_DESCRIPTION);
    assertStringIncludes(new MemoryFormatter().formatPendingShowMarkdown(showResult), "# Pending Proposal");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApprove approves global proposal", async () => {
  const { commands, extractor, memoryBank, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await memoryBank.initGlobalMemory();

    const execution = new ExecutionMemoryBuilder("GlobalProject").build();
    const proposalId = await extractor.createProposal(buildTestProposalData(), execution, "test-role");

    const result = await commands.pendingApprove(proposalId);
    assertEquals(result.id, proposalId);
    assertEquals(result.title, TEST_PENDING_LEARNING_TITLE);
    assertEquals(result.mergedTo, MemoryScope.GLOBAL);

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
    const proposalId = await extractor.createProposal(buildTestProposalData(), execution, "test-role");

    await commands.pendingReject(proposalId, TEST_PENDING_REASON);
    assertEquals(await commands.pendingList(false), []);
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
    await extractor.createProposal(buildTestProposalData(), globalExecution, "test-role");

    const projectExecution = new ExecutionMemoryBuilder("PendingProject").build();
    await extractor.createProposal(
      buildTestProposalData(MemoryScope.PROJECT, "PendingProject"),
      projectExecution,
      "test-role",
    );

    const result = await commands.pendingApproveAll();
    assertEquals(result.length, 2);
  } finally {
    await cleanup();
  }
});

// Skills Commands Coverage

Deno.test("MemoryCommands: skillList returns no skills when none exist", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.skillList();

    assertEquals(result.skills, []);
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

    assertEquals(createResult.skill_id, TEST_SKILL_ID);

    const listed = await commands.skillList({ category: MemoryBankSource.LEARNED });
    assertEquals(listed.skills[0].skill_id, TEST_SKILL_ID);

    const showResult = await commands.skillShow(TEST_SKILL_ID);
    assertEquals(showResult.skill.title, TEST_SKILL_NAME);
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
    const [draft] = await skills.listSkills({ status: SkillStatus.DRAFT });
    await skills.activateSkill(TEST_SKILL_ID, draft.id, testSkillContext());

    const result = await commands.skillMatch(TEST_SKILL_REQUEST_TEXT, {
      taskType: TEST_SKILL_TASK_TYPE,
    });

    assertEquals(result[0].skillId, TEST_SKILL_ID);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: skillDerive returns the derived skill", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.skillDerive({
      learningIds: [crypto.randomUUID()],
      name: TEST_DERIVED_SKILL_NAME,
      description: TEST_DERIVED_SKILL_DESCRIPTION,
      instructions: TEST_DERIVED_SKILL_INSTRUCTIONS,
    });

    assertEquals(result.skill_id, TEST_DERIVED_SKILL_ID);
  } finally {
    await cleanup();
  }
});
