/**
 * @module MemoryAutoApprovalAdapterTest
 * @path tests/services/adapters/memory_auto_approval_adapter_test.ts
 * @description Unit tests for the memory auto-approval adapter to increase coverage on adapter delegation.
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MemoryAutoApprovalAdapter } from "../../../src/services/adapters/memory_auto_approval_adapter.ts";
import {
  ConfidenceAssessmentLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryRecordStatus,
  MemoryScope,
} from "../../../src/shared/enums.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IMemoryExtractorService } from "../../../src/shared/interfaces/i_memory_extractor_service.ts";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";

type EligibleProposalWithAt = IMemoryUpdateProposal & {
  learning: {
    eligible_at: string;
  };
};

function asConfig(value: unknown): Config {
  return value as Config;
}

function asMemoryExtractorService(value: unknown): IMemoryExtractorService {
  return value as IMemoryExtractorService;
}

describe("MemoryAutoApprovalAdapter", () => {
  it("delegates listEligible to the auto-approval service and returns eligible proposals", async () => {
    const config = asConfig({
      memory: {
        auto_approve: {
          enabled: true,
          confidence_threshold: "MEDIUM",
          delay_hours: 0,
          sources_allowed: ["agent"],
          max_batch_size: 10,
        },
      },
    });

    const pendingProposal: IMemoryUpdateProposal = {
      id: "00000000-0000-0000-0000-000000000001",
      created_at: new Date().toISOString(),
      operation: MemoryOperation.ADD,
      target_scope: MemoryScope.GLOBAL,
      target_project: undefined,
      learning: {
        id: "00000000-0000-0000-0000-000000000011",
        created_at: new Date().toISOString(),
        source: MemoryBankSource.AGENT,
        source_id: "source-1",
        scope: MemoryScope.GLOBAL,
        project: undefined,
        title: "Test Learning",
        description: "Testing auto approval",
        category: LearningCategory.PATTERN,
        tags: [],
        confidence: ConfidenceAssessmentLevel.HIGH,
        extracted_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        references: [],
      },
      reason: "test",
      identity_id: "identity-1",
      execution_id: undefined,
      status: MemoryRecordStatus.PENDING,
      reviewed_at: undefined,
      reviewed_by: undefined,
    };

    const memoryExtractor = asMemoryExtractorService({
      listPending: () => Promise.resolve([pendingProposal]),
      approvePending: () => Promise.resolve(),
    });

    const adapter = new MemoryAutoApprovalAdapter(config, memoryExtractor);
    const eligible = await adapter.listEligible();

    assertEquals(eligible.length, 1);
    const firstEligible = eligible[0] as EligibleProposalWithAt;
    assertExists(firstEligible.learning.eligible_at);
  });

  it("returns an empty array when auto-approval is disabled", async () => {
    const config = asConfig({
      memory: {
        auto_approve: {
          enabled: false,
          confidence_threshold: "HIGH",
          delay_hours: 0,
          sources_allowed: ["agent"],
          max_batch_size: 10,
        },
      },
    });

    const memoryExtractor = asMemoryExtractorService({
      listPending: () => Promise.reject(new Error("Should not be called")),
    });

    const adapter = new MemoryAutoApprovalAdapter(config, memoryExtractor);
    const eligible = await adapter.listEligible();

    assertEquals(eligible, []);
  });
});
