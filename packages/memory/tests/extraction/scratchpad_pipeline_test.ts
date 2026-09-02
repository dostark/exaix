/**
 * @module ScratchpadPipelineTest
 * @path packages/memory/tests/extraction/scratchpad_pipeline_test.ts
 * @description [integration] A real execution with 2+ scratchpad appends (the same append the
 * remember_fact tool delegates to) produces a matching, deduplicated number of extraction
 * candidates; each lands in Memory/Pending/ through the normal approval workflow and none
 * appears directly in global memory unapproved.
 */

import { assertEquals } from "@std/assert";

import { EventLogger } from "@exaix/core/logger";
import {
  HeuristicExtractionStrategy,
  MemoryBankService,
  MemoryExtractorService,
  ScratchpadService,
} from "@exaix/memory";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IMemoryCostRouter } from "@exaix/core/types";

Deno.test("[integration] scratchpad appends reach the normal Pending -> approval pipeline, never direct-to-global", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    const scratchpad = new ScratchpadService(config, new EventLogger({ db }));
    const memoryBank = new MemoryBankService(config, new EventLogger({ db }));
    const router = castAny<IMemoryCostRouter>({
      isRemoteAllowed: () => Promise.resolve(false),
      recordOperation: () => Promise.resolve(),
    });
    const extractorService = new MemoryExtractorService(config, db, memoryBank, new EventLogger({ db }), {
      costRouter: router,
      heuristicStrategy: new HeuristicExtractionStrategy(scratchpad),
    });

    // Two remember_fact-equivalent appends (ScratchpadService.append is what the tool delegates to);
    // the second restates the lessons_learned entry below and must be deduplicated, not double-extracted.
    await scratchpad.append(traceId, "Rate limiter resets on full restart, not per request");
    await scratchpad.append(traceId, "Always validate portal mount paths before file writes");

    const execution = createMinimalExecutionMemory({
      trace_id: traceId,
      summary: "Executed the portal file-write flow.",
      lessons_learned: ["Always validate portal mount paths before file writes"],
    });

    const candidates = await extractorService.analyzeExecution(execution);
    assertEquals(candidates.length, 2, "scratchpad#1 + shared insight (deduplicated) must yield two candidates");

    for (const candidate of candidates) {
      await extractorService.createProposal(candidate, execution, "test-identity");
    }

    const pending = await extractorService.listPending();
    assertEquals(pending.length, 2, "every candidate must land in Memory/Pending/");
    assertEquals(pending.every((p) => p.status === "pending"), true, "proposals must be PENDING, not approved");

    const global = await memoryBank.getGlobalMemory();
    assertEquals(
      global?.learnings?.length ?? 0,
      0,
      "scratchpad content must never reach global memory without approval",
    );
  } finally {
    await cleanup();
  }
});
