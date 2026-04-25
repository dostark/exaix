/**
 * @module MemoryCommandsPendingTest
 * @path tests/cli/memory_commands_pending_test.ts
 * @description Verifies CLI control for pending memory proposals, ensuring users can list,
 * review, and approve agent-suggested learnings before permanent archival.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { UIOutputFormat } from "@exaix/core";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";

import { TestEnvironmentFactory } from "../fixtures/test_environment_factory.ts";
import { ExecutionMemoryBuilder } from "../fixtures/memory_builder.ts";
import { createTestProject } from "../helpers/memory_test_helper.ts";

/**
 * Helper to create a test environment with a pending proposal
 */
async function createTestEnvironmentWithProposal(traceId?: string) {
  const { commands, memoryBank, extractor, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment({
    withExtractor: true,
  });

  // Create a project first
  await createTestProject(memoryBank, "test-app", { overview: "Test project" });

  // Create a pending proposal
  const execution = new ExecutionMemoryBuilder("test-app", traceId ?? "550e8400-e29b-41d4-a716-446655440030")
    .withIdentity("senior-coder")
    .withSummary("Implemented repository pattern for database access with proper error handling.")
    .addContextFile("src/services/user.ts")
    .withChanges({
      files_created: ["src/repos/user_repo.ts"],
      files_modified: ["src/services/user.ts"],
    })
    .addLesson("Repository pattern improves testability")
    .build();

  const learnings = await extractor.analyzeExecution(execution);
  let proposalId: string | null = null;

  if (learnings.length > 0) {
    proposalId = await extractor.createProposal(learnings[0], execution, "senior-coder");
  }

  return { commands, memoryBank, extractor, cleanup, proposalId, learnings };
}

// ===== Pending List Tests =====

Deno.test("MemoryCommands: pendingList returns empty message", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingList(false, UIOutputFormat.TABLE);

    assertStringIncludes(result, "No pending");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingList shows proposals", async () => {
  const { commands, cleanup, proposalId } = await createTestEnvironmentWithProposal();
  try {
    const result = await commands.pendingList(false, UIOutputFormat.TABLE);

    // Should show the pending proposal
    if (proposalId) {
      assertStringIncludes(result, "Pending");
    }
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingList --format json outputs valid JSON", async () => {
  const { commands, cleanup } = await createTestEnvironmentWithProposal();
  try {
    const result = await commands.pendingList(false, UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(Array.isArray(parsed), true);
  } finally {
    await cleanup();
  }
});

// ===== Pending Show Tests =====

Deno.test("MemoryCommands: pendingShow displays proposal details", async () => {
  const { commands, cleanup, proposalId } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440031",
  );
  try {
    if (!proposalId) return;

    const result = await commands.pendingShow(proposalId, UIOutputFormat.TABLE);

    assertStringIncludes(result, proposalId.substring(0, 8));
    assertStringIncludes(result, MemoryStatus.PENDING);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingShow non-existent returns error", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingShow("non-existent-id", UIOutputFormat.TABLE);

    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingShow --format json outputs valid JSON", async () => {
  const { commands, cleanup, proposalId } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440032",
  );
  try {
    if (!proposalId) return;

    const result = await commands.pendingShow(proposalId, UIOutputFormat.JSON);
    const parsed = JSON.parse(result);

    assertEquals(parsed.id, proposalId);
    assertEquals(parsed.status, MemoryStatus.PENDING);
  } finally {
    await cleanup();
  }
});

// ===== Pending Approve Tests =====

Deno.test("MemoryCommands: pendingApprove merges learning", async () => {
  const { commands, memoryBank, cleanup, proposalId } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440033",
  );
  try {
    if (!proposalId) return;

    const result = await commands.pendingApprove(proposalId);

    assertStringIncludes(result, MemoryStatus.APPROVED);

    // Verify learning was added
    const project = await memoryBank.getProjectMemory("test-app");
    assertEquals(project !== null, true);
    assertEquals(project!.patterns.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApprove non-existent returns error", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingApprove("non-existent-id");

    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

// ===== Pending Reject Tests =====

Deno.test("MemoryCommands: pendingReject archives proposal", async () => {
  const { commands, cleanup, proposalId } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440034",
  );
  try {
    if (!proposalId) return;

    const result = await commands.pendingReject(proposalId, "Not relevant");

    assertStringIncludes(result, MemoryStatus.REJECTED);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingReject non-existent returns error", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingReject("non-existent-id", "test");

    assertStringIncludes(result, "not found");
  } finally {
    await cleanup();
  }
});

// ===== Pending Approve All Tests =====

Deno.test("MemoryCommands: pendingApproveAll processes all", async () => {
  const { commands, memoryBank, extractor, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment({
    withExtractor: true,
  });
  try {
    await createTestProject(memoryBank, "test-app", { overview: "Test project" });

    const execution = new ExecutionMemoryBuilder("test-app", "550e8400-e29b-41d4-a716-446655440035")
      .withIdentity("senior-coder")
      .addLesson("Repository pattern improves testability")
      .build();

    const learnings = await extractor.analyzeExecution(execution);

    // Create multiple proposals
    for (const learning of learnings.slice(0, 2)) {
      await extractor.createProposal(learning, execution, "senior-coder");
    }

    const result = await commands.pendingApproveAll();

    assertStringIncludes(result.toLowerCase(), MemoryStatus.APPROVED);

    // Verify no pending remain
    const pending = await extractor.listPending();
    assertEquals(pending.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApproveAll with none returns message", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const result = await commands.pendingApproveAll();

    assertStringIncludes(result.toLowerCase(), "no pending");
  } finally {
    await cleanup();
  }
});
