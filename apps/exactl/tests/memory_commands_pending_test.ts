/**
 * @module MemoryCommandsPendingTest
 * @path apps/exactl/tests/memory_commands_pending_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies CLI control for pending memory proposals, ensuring users can list,
 * review, and approve agent-suggested learnings before permanent archival.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { MemoryApprovalReader } from "../src/commands/memory_approval_reader.ts";
import { MemoryStatus } from "@exaix/core/status";

import { TestEnvironmentFactory } from "../../../tests/fixtures/test_environment_factory.ts";
import { ExecutionMemoryBuilder } from "../../../tests/fixtures/memory_builder.ts";
import { createTestProject } from "@exaix/testing";

/**
 * Helper to create a test environment with a pending proposal
 */
async function createTestEnvironmentWithProposal(traceId?: string) {
  const { curationCommands, context, memoryBank, extractor, cleanup } = await TestEnvironmentFactory
    .createMemoryEnvironment({
      withExtractor: true,
    });

  // Create a project first
  await createTestProject(memoryBank, "test-app", { overview: "Test project" });

  // Create a pending proposal
  const execution = new ExecutionMemoryBuilder("test-app", traceId ?? "550e8400-e29b-41d4-a716-446655440030")
    .withAgentRole("senior-coder")
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

  return { curationCommands, context, memoryBank, extractor, cleanup, proposalId, learnings };
}

// Pending List Tests

Deno.test("MemoryApprovalReader: listPendingProposals returns the proposals that pendingList prints", async () => {
  const { context, extractor, cleanup, proposalId, curationCommands } = await createTestEnvironmentWithProposal();
  try {
    assert(proposalId !== null, "the seeded environment must hold one proposal");
    const proposals = await new MemoryApprovalReader(context).listPendingProposals();
    assertEquals(proposals.map((proposal) => proposal.id), [proposalId]);
    assertEquals(proposals, await extractor.listPending());
    assertEquals((await curationCommands.pendingList(false)).map((proposal) => proposal.id), [proposalId]);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingList returns no proposals when none are pending", async () => {
  const { cleanup, curationCommands } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    assertEquals(await curationCommands.pendingList(false), []);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingList shows proposals", async () => {
  const { cleanup, proposalId, curationCommands } = await createTestEnvironmentWithProposal();
  try {
    const result = await curationCommands.pendingList(false);

    // Should list the pending proposal
    if (proposalId) {
      assertStringIncludes(new MemoryFormatter().formatPendingListTable(result), "Pending");
    }
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingList returns an array", async () => {
  const { cleanup, curationCommands } = await createTestEnvironmentWithProposal();
  try {
    assertEquals(Array.isArray(await curationCommands.pendingList(false)), true);
  } finally {
    await cleanup();
  }
});

// Pending Show Tests

Deno.test("MemoryCommands: pendingShow displays proposal details", async () => {
  const { cleanup, proposalId, curationCommands } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440031",
  );
  try {
    if (!proposalId) return;

    const result = new MemoryFormatter().formatPendingShowTable(await curationCommands.pendingShow(proposalId));

    assertStringIncludes(result, proposalId.substring(0, 8));
    assertStringIncludes(result, MemoryStatus.PENDING);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingShow of an unknown id fails with the not-found code", async () => {
  const { cleanup, curationCommands } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => curationCommands.pendingShow("non-existent-id"), ExaCtlError);

    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
    assertStringIncludes(error.message, "not found");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingShow returns the stored proposal", async () => {
  const { cleanup, proposalId, curationCommands } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440032",
  );
  try {
    if (!proposalId) return;

    const parsed = await curationCommands.pendingShow(proposalId);

    assertEquals(parsed.id, proposalId);
    assertEquals(parsed.status, MemoryStatus.PENDING);
  } finally {
    await cleanup();
  }
});

// Pending Approve Tests

Deno.test("MemoryCommands: pendingApprove merges learning", async () => {
  const { memoryBank, cleanup, proposalId, curationCommands } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440033",
  );
  try {
    if (!proposalId) return;

    const result = await curationCommands.pendingApprove(proposalId);

    assertEquals(result.id, proposalId);

    // Verify learning was added
    const project = await memoryBank.getProjectMemory("test-app");
    assertEquals(project !== null, true);
    assertEquals(project!.patterns.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApprove of an unknown id fails with the not-found code", async () => {
  const { cleanup, curationCommands } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => curationCommands.pendingApprove("non-existent-id"), ExaCtlError);

    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
  } finally {
    await cleanup();
  }
});

// Pending Reject Tests

Deno.test("MemoryCommands: pendingReject archives proposal", async () => {
  const { cleanup, proposalId, curationCommands } = await createTestEnvironmentWithProposal(
    "550e8400-e29b-41d4-a716-446655440034",
  );
  try {
    if (!proposalId) return;

    await curationCommands.pendingReject(proposalId, "Not relevant");

    assertEquals(await curationCommands.pendingList(false), []);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingReject of an unknown id fails with the not-found code", async () => {
  const { cleanup, curationCommands } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    const error = await assertRejects(() => curationCommands.pendingReject("non-existent-id", "test"), ExaCtlError);

    assertEquals(error.code, ExaCtlExitCode.NOT_FOUND);
  } finally {
    await cleanup();
  }
});

// Pending Approve All Tests

Deno.test("MemoryCommands: pendingApproveAll processes all", async () => {
  const { memoryBank, extractor, cleanup, curationCommands } = await TestEnvironmentFactory
    .createMemoryEnvironment({
      withExtractor: true,
    });
  try {
    await createTestProject(memoryBank, "test-app", { overview: "Test project" });

    const execution = new ExecutionMemoryBuilder("test-app", "550e8400-e29b-41d4-a716-446655440035")
      .withAgentRole("senior-coder")
      .addLesson("Repository pattern improves testability")
      .build();

    const learnings = await extractor.analyzeExecution(execution);

    // Create multiple proposals
    for (const learning of learnings.slice(0, 2)) {
      await extractor.createProposal(learning, execution, "senior-coder");
    }

    const result = await curationCommands.pendingApproveAll();

    assertEquals(result.length > 0, true);

    // Verify no pending remain
    const pending = await extractor.listPending();
    assertEquals(pending.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryCommands: pendingApproveAll with none approves nothing", async () => {
  const { cleanup, curationCommands } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    assertEquals(await curationCommands.pendingApproveAll(), []);
  } finally {
    await cleanup();
  }
});
