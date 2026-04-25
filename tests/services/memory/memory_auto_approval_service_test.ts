/**
 * @module MemoryAutoApprovalServiceTest
 * @path tests/services/memory/memory_auto_approval_service_test.ts
 * @description TDD tests for MemoryAutoApprovalService.
 */

import { assertEquals } from "@std/assert";
import { MemoryAutoApprovalService } from "../../../src/services/memory/memory_auto_approval_service.ts";
import {
  ConfidenceAssessmentLevel,
  MemoryBankSource,
  MemoryOperation,
  MemoryRecordStatus,
  MemoryScope,
} from "@exaix/core";
import { createMockConfig } from "../../helpers/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IMemoryUpdateProposal } from "@exaix/schemas/memory_bank.ts";
import type { MemoryExtractorService } from "../../../src/services/memory/memory_extractor.ts";

const now = new Date();
const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000 + 5000)).toISOString();
const oneHourAgo = new Date(now.getTime() - (1 * 60 * 60 * 1000)).toISOString();

function createMockProposal(
  source: MemoryBankSource,
  confidence: ConfidenceAssessmentLevel,
  extractedAt: string,
  id = crypto.randomUUID(),
): IMemoryUpdateProposal {
  return Object.assign({}, {
    id,
    created_at: now.toISOString(),
    operation: MemoryOperation.ADD,
    target_scope: MemoryScope.PROJECT,
    reason: "test",
    identity_id: "test",
    status: MemoryRecordStatus.PENDING,
    learning: {
      id: crypto.randomUUID(),
      created_at: now.toISOString(),
      source,
      confidence,
      extracted_at: extractedAt,
      scope: MemoryScope.PROJECT,
      title: "test",
      description: "test",
      category: "insight",
      tags: [],
    },
  }) as IMemoryUpdateProposal;
}

function createAutoApproveConfig(overrides: Partial<Config["memory"]["auto_approve"]> = {}) {
  return createMockConfig(".", {
    memory: {
      auto_approve: {
        enabled: true,
        confidence_threshold: ConfidenceAssessmentLevel.HIGH,
        delay_hours: 2,
        sources_allowed: [MemoryBankSource.AGENT],
        max_batch_size: 20,
        ...overrides,
      },
    },
  });
}

Deno.test("Step 71.2: MemoryAutoApprovalService filters eligible proposals correctly", async () => {
  const config = createAutoApproveConfig({
    sources_allowed: [MemoryBankSource.LEARNED],
  });

  const eligibleProposal = createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);
  const tooYoungProposal = createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, oneHourAgo);
  const lowConfidenceProposal = createMockProposal(
    MemoryBankSource.LEARNED,
    ConfidenceAssessmentLevel.LOW,
    twoHoursAgo,
  );
  const userProposal = createMockProposal(MemoryBankSource.USER, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);

  const mockPending: IMemoryUpdateProposal[] = [
    eligibleProposal,
    tooYoungProposal,
    lowConfidenceProposal,
    userProposal,
  ];

  const mockMemoryExtractor = Object.assign({}, {
    listPending: () => Promise.resolve(mockPending),
  }) as MemoryExtractorService;

  const service = new MemoryAutoApprovalService(config, mockMemoryExtractor);
  const eligible = await service.listEligible();

  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].id, eligibleProposal.id);
});

Deno.test("Step 71.2: MemoryAutoApprovalService treats AGENT as alias for EXECUTION-based proposals", async () => {
  const config = createAutoApproveConfig();

  const eligibleProposal = createMockProposal(MemoryBankSource.EXECUTION, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);
  const userProposal = createMockProposal(MemoryBankSource.USER, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);

  const mockPending: IMemoryUpdateProposal[] = [
    eligibleProposal,
    userProposal,
  ];

  const mockMemoryExtractor = Object.assign({}, {
    listPending: () => Promise.resolve(mockPending),
  }) as MemoryExtractorService;

  const service = new MemoryAutoApprovalService(config, mockMemoryExtractor);
  const eligible = await service.listEligible();

  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].id, eligibleProposal.id);
  assertEquals(typeof eligible[0].learning.eligible_at, "string");
});

Deno.test("Step 71.6: MemoryAutoApprovalService treats AGENT as alias for LEARNED-based proposals", async () => {
  const config = createAutoApproveConfig();

  const eligibleProposal = createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);
  const userProposal = createMockProposal(MemoryBankSource.USER, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);

  const mockPending: IMemoryUpdateProposal[] = [
    eligibleProposal,
    userProposal,
  ];

  const mockMemoryExtractor = Object.assign({}, {
    listPending: () => Promise.resolve(mockPending),
  }) as MemoryExtractorService;

  const service = new MemoryAutoApprovalService(config, mockMemoryExtractor);
  const eligible = await service.listEligible();

  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].id, eligibleProposal.id);
  assertEquals(eligible[0].learning.source, MemoryBankSource.LEARNED);
  assertEquals(typeof eligible[0].learning.eligible_at, "string");
});

Deno.test("Step 71.6: MemoryAutoApprovalService passes autoApproved=true to approvePending", async () => {
  const config = createAutoApproveConfig({
    sources_allowed: [MemoryBankSource.LEARNED],
    max_batch_size: 1,
  });

  const eligibleProposal = createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, twoHoursAgo);
  const calls: Array<{ id: string; autoApproved?: boolean }> = [];

  const mockMemoryExtractor = Object.assign({}, {
    listPending: () => Promise.resolve([eligibleProposal]),
    approvePending: (id: string, autoApproved?: boolean) => {
      calls.push({ id, autoApproved });
      return Promise.resolve();
    },
  }) as MemoryExtractorService;

  const service = new MemoryAutoApprovalService(config, mockMemoryExtractor);
  const result = await service.runApprovalCycle({ dryRun: false });

  assertEquals(result.promoted, [eligibleProposal.id]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], { id: eligibleProposal.id, autoApproved: true });
});

Deno.test("Step 71.2: MemoryAutoApprovalService respects batch limits", async () => {
  const config = createAutoApproveConfig({
    sources_allowed: [MemoryBankSource.LEARNED],
    max_batch_size: 2,
  });

  const mockPending: IMemoryUpdateProposal[] = [
    createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, twoHoursAgo),
    createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, twoHoursAgo),
    createMockProposal(MemoryBankSource.LEARNED, ConfidenceAssessmentLevel.HIGH, twoHoursAgo),
  ];

  const approvedIds: string[] = [];
  const mockMemoryExtractor = Object.assign({}, {
    listPending: () => Promise.resolve(mockPending),
    approvePending: (id: string) => {
      approvedIds.push(id);
      return Promise.resolve();
    },
  }) as MemoryExtractorService;

  const service = new MemoryAutoApprovalService(config, mockMemoryExtractor);
  const result = await service.runApprovalCycle({ dryRun: false });

  assertEquals(result.promoted.length, 2);
  assertEquals(result.skipped.length, 1);
  assertEquals(approvedIds.length, 2);
});
