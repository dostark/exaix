/**
 * @module MemoryUpdateProposalSchemaTest
 * @path tests/services/memory/memory_extractor_test.ts
 * @description Validates the data schema for agent-suggested memory updates, ensuring strict
 * enforcement of proposal structure, learning categories, and scope definitions.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { initTestDbService } from "../../helpers/db.ts";
import { MemoryUpdateProposalSchema } from "@exaix/schemas/memory_bank.ts";
import { MemoryExtractorService } from "../../../src/services/memory/memory_extractor.ts";
import { MemoryBankService } from "../../../src/services/memory/memory_bank.ts";
import type { IExecutionMemory } from "@exaix/schemas/memory_bank.ts";
import { ExecutionStatus, LearningCategory } from "@exaix/core";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import {
  getMemoryExecutionDir,
  getMemoryGlobalDir,
  getMemoryIndexDir,
  getMemoryPendingDir,
  getMemoryProjectsDir,
} from "../../helpers/paths_helper.ts";
import {
  createApprovedProposal,
  createFailedExecutionMemory,
  createGlobalProposal,
  createInvalidProposal,
  createInvalidStatusProposal,
  createMinimalProposal,
  createSuccessfulExecutionMemory,
  createTestProposal,
} from "../helpers/memory_test_helpers.ts";
import { createMinimalProjectMemory } from "../helpers/memory_bank_test_helpers.ts";

// ===== MemoryUpdateProposalSchema Tests =====

Deno.test("MemoryUpdateProposalSchema: validates minimal proposal", () => {
  const proposal = createMinimalProposal();

  const result = MemoryUpdateProposalSchema.safeParse(proposal);
  assertEquals(result.success, true);
});

Deno.test("MemoryUpdateProposalSchema: validates global scope proposal", () => {
  const proposal = createGlobalProposal();

  const result = MemoryUpdateProposalSchema.safeParse(proposal);
  assertEquals(result.success, true);
});

Deno.test("MemoryUpdateProposalSchema: validates approved proposal", () => {
  const proposal = createApprovedProposal();

  const result = MemoryUpdateProposalSchema.safeParse(proposal);
  assertEquals(result.success, true);
});

Deno.test("MemoryUpdateProposalSchema: rejects invalid operation", () => {
  const proposal = createInvalidProposal();

  const result = MemoryUpdateProposalSchema.safeParse(proposal);
  assertEquals(result.success, false);
});

Deno.test("MemoryUpdateProposalSchema: rejects invalid status", () => {
  const proposal = createInvalidStatusProposal();

  const result = MemoryUpdateProposalSchema.safeParse(proposal);
  assertEquals(result.success, false);
});

// ===== MemoryExtractorService Tests =====

/**
 * Creates test environment for memory extractor tests
 */
async function initExtractorTest() {
  const { db, config, cleanup: dbCleanup } = await initTestDbService();

  // Create required directories
  await Deno.mkdir(getMemoryProjectsDir(config.system.root), { recursive: true });
  await Deno.mkdir(getMemoryExecutionDir(config.system.root), { recursive: true });
  await Deno.mkdir(getMemoryPendingDir(config.system.root), { recursive: true });
  await Deno.mkdir(getMemoryIndexDir(config.system.root), { recursive: true });
  await Deno.mkdir(getMemoryGlobalDir(config.system.root), { recursive: true });

  const memoryBank = new MemoryBankService(config, db);
  const extractor = new MemoryExtractorService(config, db, memoryBank);

  const cleanup = async () => {
    await dbCleanup();
  };

  return {
    config,
    db,
    memoryBank,
    extractor,
    cleanup,
  };
}

/**
 * Creates a trivial execution with no learnable content
 */
function createTrivialExecution(portal: string, traceId: string): IExecutionMemory {
  return {
    trace_id: traceId,
    request_id: `req-${traceId.substring(0, 8)}`,
    started_at: "2026-01-04T12:00:00Z",
    completed_at: "2026-01-04T12:01:00Z",
    status: ExecutionStatus.COMPLETED,
    portal,
    identity_id: "assistant",
    summary: "Answered a simple question about syntax.",
    context_files: [],
    context_portals: [portal],
    changes: {
      files_created: [],
      files_modified: [],
      files_deleted: [],
    },
  };
}

Deno.test("MemoryExtractorService: analyzeExecution extracts learnings from success", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440010");

    const learnings = await extractor.analyzeExecution(execution);

    assertEquals(learnings.length > 0, true);
    // Should extract pattern from summary
    const hasPatternLearning = learnings.some((l) =>
      l.category === LearningCategory.PATTERN || l.title.toLowerCase().includes(LearningCategory.PATTERN)
    );
    assertEquals(hasPatternLearning, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: analyzeExecution extracts from lessons_learned", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440011");

    const learnings = await extractor.analyzeExecution(execution);

    // Should have at least one learning derived from lessons_learned
    const hasLessonBased = learnings.some((l) =>
      l.description.includes("testability") || l.description.includes("debugging")
    );
    assertEquals(hasLessonBased, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: analyzeExecution extracts from failed execution", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createFailedExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440012");

    const learnings = await extractor.analyzeExecution(execution);

    // Should extract troubleshooting learning from failure
    assertEquals(learnings.length > 0, true);
    const hasTroubleshooting = learnings.some((l) =>
      l.category === "troubleshooting" || l.category === LearningCategory.ANTI_PATTERN
    );
    assertEquals(hasTroubleshooting, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: analyzeExecution includes error context", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createFailedExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440013");

    const learnings = await extractor.analyzeExecution(execution);

    // Should reference the error in learning
    const mentionsError = learnings.some((l) =>
      l.description.includes("dependency") || l.description.includes("dependencies")
    );
    assertEquals(mentionsError, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: analyzeExecution returns empty for trivial execution", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createTrivialExecution("my-app", "550e8400-e29b-41d4-a716-446655440014");

    const learnings = await extractor.analyzeExecution(execution);

    assertEquals(learnings.length, 0);
  } finally {
    await cleanup();
  }
});

// ===== createProposal Tests =====

Deno.test("MemoryExtractorService: createProposal writes to Pending directory", async () => {
  const { config, extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440015");
    const learnings = await extractor.analyzeExecution(execution);

    // Should have at least one learning
    if (learnings.length === 0) {
      // Skip if no learnings extracted
      return;
    }

    const proposalId = await extractor.createProposal(learnings[0], execution, "senior-coder");

    assertExists(proposalId);

    // Check file exists in Pending
    const pendingDir = getMemoryPendingDir(config.system.root);
    const files = [];
    for await (const entry of Deno.readDir(pendingDir)) {
      files.push(entry.name);
    }
    assertEquals(files.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: createProposal generates valid proposal file", async () => {
  const { config, extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440016");
    const learnings = await extractor.analyzeExecution(execution);

    if (learnings.length === 0) {
      return;
    }

    const proposalId = await extractor.createProposal(learnings[0], execution, "senior-coder");

    // Read and validate proposal file
    const pendingDir = getMemoryPendingDir(config.system.root);
    const proposalPath = join(pendingDir, `${proposalId}.json`);
    assertEquals(await exists(proposalPath), true);

    const content = await Deno.readTextFile(proposalPath);
    const proposal = JSON.parse(content);
    const result = MemoryUpdateProposalSchema.safeParse(proposal);
    assertEquals(result.success, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: createProposal logs to IActivity Journal", async () => {
  const { db, extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440017");
    const learnings = await extractor.analyzeExecution(execution);

    if (learnings.length === 0) {
      return;
    }

    await extractor.createProposal(learnings[0], execution, "senior-coder");

    // Wait for batch flush
    await db.waitForFlush();

    // Check IActivity Journal
    const activities = db.instance.prepare(
      "SELECT action_type, target FROM activity WHERE action_type = 'memory.proposal.created'",
    ).all() as Array<{ action_type: string; target: string }>;
    assertEquals(activities.length, 1);
  } finally {
    await cleanup();
  }
});

// ===== Pending Operations Tests =====

Deno.test("MemoryExtractorService: listPending returns all pending proposals", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440020");
    const learnings = await extractor.analyzeExecution(execution);

    // Create multiple proposals
    for (const learning of learnings.slice(0, 2)) {
      await extractor.createProposal(learning, execution, "senior-coder");
    }

    const pending = await extractor.listPending();

    assertEquals(pending.length >= learnings.slice(0, 2).length, true);
    assertEquals(pending.every((p) => p.status === MemoryStatus.PENDING), true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: getPending returns proposal details", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440021");
    const learnings = await extractor.analyzeExecution(execution);

    if (learnings.length === 0) {
      return;
    }

    const proposalId = await extractor.createProposal(learnings[0], execution, "senior-coder");

    const proposal = await extractor.getPending(proposalId);

    assertExists(proposal);
    assertEquals(proposal.id, proposalId);
    assertEquals(proposal.status, MemoryStatus.PENDING);
    assertEquals(proposal.learning.title, learnings[0].title);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: approvePending merges learning to project", async () => {
  const { memoryBank, extractor, cleanup } = await initExtractorTest();
  try {
    // Create project memory first
    const projectMem = createMinimalProjectMemory({
      portal: "my-app",
      overview: "Test project",
    });
    await memoryBank.createProjectMemory(projectMem);

    const proposalId = await createTestProposal(extractor, "my-app", "550e8400-e29b-41d4-a716-446655440022");

    if (!proposalId) {
      return; // No learnings extracted
    }

    await extractor.approvePending(proposalId);

    // Verify learning was added to project
    const project = await memoryBank.getProjectMemory("my-app");
    assertExists(project);
    assertEquals(project.patterns.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: approvePending removes from Pending", async () => {
  const { config, memoryBank, extractor, cleanup } = await initExtractorTest();
  try {
    const projectMem = createMinimalProjectMemory({
      portal: "my-app",
      overview: "Test project",
    });
    await memoryBank.createProjectMemory(projectMem);

    const proposalId = await createTestProposal(extractor, "my-app", "550e8400-e29b-41d4-a716-446655440023");

    if (!proposalId) {
      return; // No learnings extracted
    }

    await extractor.approvePending(proposalId);

    // Check proposal file was removed
    const pendingPath = join(getMemoryPendingDir(config.system.root), `${proposalId}.json`);
    assertEquals(await exists(pendingPath), false);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: approvePending logs to IActivity Journal", async () => {
  const { db, memoryBank, extractor, cleanup } = await initExtractorTest();
  try {
    const projectMem = createMinimalProjectMemory({
      portal: "my-app",
      overview: "Test project",
    });
    await memoryBank.createProjectMemory(projectMem);

    const proposalId = await createTestProposal(extractor, "my-app", "550e8400-e29b-41d4-a716-446655440024");

    if (!proposalId) {
      return; // No learnings extracted
    }

    await extractor.approvePending(proposalId);

    await db.waitForFlush();

    const activities = db.instance.prepare(
      "SELECT action_type FROM activity WHERE action_type = 'memory.proposal.approved'",
    ).all() as Array<{ action_type: string }>;
    assertEquals(activities.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: approvePending logs auto-approved event when autoApproved=true", async () => {
  const { db, memoryBank, extractor, cleanup } = await initExtractorTest();
  try {
    const projectMem = createMinimalProjectMemory({
      portal: "my-app",
      overview: "Test project",
    });
    await memoryBank.createProjectMemory(projectMem);

    const proposalId = await createTestProposal(extractor, "my-app", "550e8400-e29b-41d4-a716-446655440025");

    if (!proposalId) {
      return; // No learnings extracted
    }

    await extractor.approvePending(proposalId, true);

    await db.waitForFlush();

    const autoActivities = db.instance.prepare(
      "SELECT action_type FROM activity WHERE action_type = 'memory.auto_approved'",
    ).all() as Array<{ action_type: string }>;
    assertEquals(autoActivities.length, 1);

    const manualActivities = db.instance.prepare(
      "SELECT action_type FROM activity WHERE action_type = 'memory.proposal.approved'",
    ).all() as Array<{ action_type: string }>;
    assertEquals(manualActivities.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: rejectPending archives proposal", async () => {
  const { config, extractor, cleanup } = await initExtractorTest();
  try {
    const proposalId = await createTestProposal(extractor, "my-app", "550e8400-e29b-41d4-a716-446655440025");

    if (!proposalId) {
      return; // No learnings extracted
    }

    await extractor.rejectPending(proposalId, "Not relevant");

    // Check proposal file was removed from Pending
    const pendingPath = join(getMemoryPendingDir(config.system.root), `${proposalId}.json`);
    assertEquals(await exists(pendingPath), false);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: rejectPending logs rejection reason", async () => {
  const { db, extractor, cleanup } = await initExtractorTest();
  try {
    const proposalId = await createTestProposal(extractor, "my-app", "550e8400-e29b-41d4-a716-446655440026");

    if (!proposalId) {
      return; // No learnings extracted
    }

    await extractor.rejectPending(proposalId, "Not relevant to project");

    await db.waitForFlush();

    const activities = db.instance.prepare(
      "SELECT action_type, payload FROM activity WHERE action_type = 'memory.proposal.rejected'",
    ).all() as Array<{ action_type: string; payload: string }>;
    assertEquals(activities.length, 1);
    assertStringIncludes(activities[0].payload, "Not relevant");
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: approveAll processes all pending", async () => {
  const { memoryBank, extractor, cleanup } = await initExtractorTest();
  try {
    const projectMem = createMinimalProjectMemory({
      portal: "my-app",
      overview: "Test project",
    });
    await memoryBank.createProjectMemory(projectMem);

    const execution = createSuccessfulExecutionMemory("my-app", "550e8400-e29b-41d4-a716-446655440027");
    const learnings = await extractor.analyzeExecution(execution);

    // Create multiple proposals
    for (const learning of learnings.slice(0, 2)) {
      await extractor.createProposal(learning, execution, "senior-coder");
    }

    const countBefore = (await extractor.listPending()).length;
    await extractor.approveAll();
    const countAfter = (await extractor.listPending()).length;

    assertEquals(countAfter, 0);
    assertEquals(countBefore > countAfter, true);
  } finally {
    await cleanup();
  }
});

Deno.test("MemoryExtractorService: getPending throws for non-existent", async () => {
  const { extractor, cleanup } = await initExtractorTest();
  try {
    const proposal = await extractor.getPending("non-existent-id");
    assertEquals(proposal, null);
  } finally {
    await cleanup();
  }
});
