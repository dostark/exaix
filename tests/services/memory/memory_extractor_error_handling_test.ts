/**
 * @module MemoryExtractorErrorHandlingTest
 * @path tests/services/memory/memory_extractor_error_handling_test.ts
 * @description Verifies the resilience of the MemoryExtractorService, ensuring that failures
 * in peripheral activity logging do not disrupt the core agent execution loop.
 */

import { assertEquals } from "@std/assert";

import { MemoryExtractorService } from "../../../src/services/memory/memory_extractor.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import type { IDatabaseService } from "../../../src/services/core/db.ts";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IExecutionMemory, IProposalLearning } from "@exaix/schemas/memory_bank.ts";

Deno.test("MemoryExtractorService: logActivity errors do not break createProposal", async () => {
  const root = await Deno.makeTempDir({ prefix: "memory-extractor-" });
  try {
    const config = createMockConfig(root);

    const db = {
      logActivity: () => {
        throw new Error("db down");
      },
    };

    const extractor = new MemoryExtractorService(
      config,
      db as Partial<IDatabaseService> as IDatabaseService,
      {} as Partial<IMemoryBankService> as IMemoryBankService,
    );

    const proposalId = await extractor.createProposal(
      {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        source: MemoryBankSource.EXECUTION,
        title: "t",
        description: "d",
        scope: MemoryScope.GLOBAL,
        category: LearningCategory.INSIGHT,
        tags: ["tag"],
        confidence: ConfidenceAssessmentLevel.HIGH,
        references: [],
      } as IProposalLearning,
      { trace_id: "trace" } as Partial<IExecutionMemory> as IExecutionMemory,
      "identityId",
    );

    assertEquals(typeof proposalId, "string");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
