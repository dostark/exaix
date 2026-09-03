/**
 * @module ExecutionLoopNoFastPathTest
 * @path packages/execution/tests/execution_loop_no_fast_path_test.ts
 * @description GAP-1 regression guard: running the loop's extraction over an execution with
 * candidates produces Pending proposals and exactly zero global-bank writes, zero
 * embedding-index entries, and zero tiered entries before approval — the proposal pipeline
 * is the only path into durable memory.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { ExecutionLoop } from "@exaix/execution";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import {
  HeuristicExtractionStrategy,
  MemoryBankService,
  MemoryEmbeddingService,
  MemoryExtractorService,
  SessionMemoryService,
} from "@exaix/memory";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IMemoryCostRouter } from "@exaix/core/types";

Deno.test("extraction loop: proposals land, but global bank, embedding index, and tiered memory stay empty before approval", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    const scratchpad = new ExecutionMemoryStore(config);
    await scratchpad.appendNote(traceId, "Rate limiter resets on full restart, not per request");

    const memoryBank = new MemoryBankService(config);
    const embeddingService = new MemoryEmbeddingService(config);
    await embeddingService.initializeManifest();
    memoryBank.setEmbeddingService(embeddingService);

    const tieredEntriesPath = join(config.system.root, "Memory", "Session", "tiered_entries.json");
    const sessionMemory = new SessionMemoryService(memoryBank, embeddingService, undefined, tieredEntriesPath);

    const costRouter = castAny<IMemoryCostRouter>({
      isRemoteAllowed: () => Promise.resolve(false),
      recordOperation: () => Promise.resolve(),
    });
    const extractor = new MemoryExtractorService(config, db, memoryBank, undefined, {
      costRouter,
      heuristicStrategy: new HeuristicExtractionStrategy(scratchpad),
    });

    await memoryBank.createExecutionRecord(createMinimalExecutionMemory({
      trace_id: traceId,
      summary: "Executed the portal file-write flow with a captured rate-limiter gotcha.",
      lessons_learned: ["Always validate portal mount paths before file writes"],
    }));

    const loop = new ExecutionLoop({
      config,
      db,
      agentRole: "gap1-test",
      memoryBank,
      sessionMemory,
      context: castAny({ extractor, config: { get: () => config } }),
    });

    await loop.extractExecutionLearnings(traceId);

    // Proposals landed.
    const extractorForAssertions = new MemoryExtractorService(config, db, memoryBank, undefined, {
      heuristicStrategy: new HeuristicExtractionStrategy(scratchpad),
    });
    const pending = await extractorForAssertions.listPending();
    assertEquals(pending.length >= 1, true, "extraction must produce Pending proposals");

    // Zero global-bank writes before approval.
    const global = await memoryBank.getGlobalMemory();
    assertEquals(
      global?.learnings?.length ?? 0,
      0,
      "no PENDING learning may reach the global bank before approval (GAP-1)",
    );

    // Zero embedding-index entries.
    const indexHits = await embeddingService.searchByEmbedding("rate limiter", { limit: 10, threshold: 0 });
    assertEquals(indexHits.length, 0, "no PENDING learning may be embedded before approval (GAP-1)");

    // Zero tiered entries.
    assertEquals(
      await exists(tieredEntriesPath),
      false,
      "no tiered entry may be created before approval (GAP-1)",
    );
  } finally {
    await cleanup();
  }
});
