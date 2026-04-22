/**
 * @module AutoApprovalCycleTest
 * @path tests/integration/memory/auto_approval_cycle_test.ts
 * @description Integration test for the full memory auto-approval cycle.
 */

import { assertEquals, assertExists } from "@std/assert";
import { MemoryAutoApprovalService } from "../../../src/services/memory/memory_auto_approval_service.ts";
import { MemoryExtractorService } from "../../../src/services/memory/memory_extractor.ts";
import { MemoryBankService } from "../../../src/services/memory/memory_bank.ts";
import { MemoryBankAdapter } from "../../../src/services/adapters/memory_bank_adapter.ts";
import { TestEnvironment } from "../helpers/test_environment.ts";
import {
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "../../../src/shared/enums.ts";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";

Deno.test("Phase 71 Integration: End-to-end memory auto-approval cycle", async () => {
  const env = await TestEnvironment.create({
    initGit: false,
    configOverrides: {
      memory: {
        auto_approve: {
          enabled: true,
          confidence_threshold: ConfidenceAssessmentLevel.HIGH,
          delay_hours: 1, // Minimum schema value for test validity
          sources_allowed: [MemoryBankSource.AGENT],
          max_batch_size: 10,
        },
      },
    },
  });

  try {
    const memoryBank = new MemoryBankService(env.config, env.db);
    const memoryAdapter = new MemoryBankAdapter(memoryBank);
    const memoryExtractor = new MemoryExtractorService(env.config, env.db, memoryAdapter);
    const autoApprovalService = new MemoryAutoApprovalService(env.config, memoryExtractor);
    const extractedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // 1. Create a high-confidence proposal (Eligible)
    const learning: IProposalLearning = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source: MemoryBankSource.EXECUTION,
      scope: MemoryScope.PROJECT,
      project: "test-portal",
      title: "Eligible Learning",
      description: "Should be auto-approved",
      category: LearningCategory.INSIGHT,
      tags: ["test"],
      confidence: ConfidenceAssessmentLevel.HIGH,
      extracted_at: extractedAt,
    };

    const execution: IExecutionMemory = {
      trace_id: crypto.randomUUID(),
      request_id: "test-request",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "test-portal",
      identity_id: "test-identity",
      summary: "Test execution",
      context_files: [],
      context_portals: [],
      changes: { files_created: [], files_modified: [], files_deleted: [] },
    };
    const proposalId = await memoryExtractor.createProposal(learning, execution, "test-identity");

    // 2. Create a low-confidence proposal (Ineligible)
    const lowLearning: IProposalLearning = {
      ...learning,
      id: crypto.randomUUID(),
      title: "Low Confidence Learning",
      confidence: ConfidenceAssessmentLevel.LOW,
      extracted_at: extractedAt,
    };
    await memoryExtractor.createProposal(lowLearning, execution, "test-identity");

    const eligibleCandidates = await autoApprovalService.listEligible();
    assertEquals(eligibleCandidates.length, 1, "List eligible should expose exactly one candidate");
    assertEquals(eligibleCandidates[0].learning.source, MemoryBankSource.EXECUTION);
    assertEquals(typeof eligibleCandidates[0].learning.eligible_at, "string");

    // 3. Run approval cycle
    const result = await autoApprovalService.runApprovalCycle();

    // 4. Verification
    assertEquals(result.promoted.length, 1, "Should promote exactly one learning");
    assertEquals(result.promoted[0], proposalId);

    // Check memory bank directly
    const projectMemory = await memoryBank.getProjectMemory("test-portal");
    assertExists(projectMemory, "Project memory should exist");

    // Search for the learning in the memory bank
    const _searchResults = await memoryBank.searchMemory("auto-approved", { portal: "test-portal" });
    // Note: Actually check overview.md or patterns.md if memoryBank updates them
    // For this integration test, we'll just check if the proposal was moved/removed from pending
    const pending = await memoryExtractor.listPending();
    assertEquals(pending.length, 1, "Only the ineligible proposal should remain pending");
    assertEquals(pending[0].learning.title, "Low Confidence Learning");
  } finally {
    await env.cleanup();
  }
});
