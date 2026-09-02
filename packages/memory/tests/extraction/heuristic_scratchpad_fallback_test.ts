/**
 * @module HeuristicScratchpadFallbackTest
 * @path packages/memory/tests/extraction/heuristic_scratchpad_fallback_test.ts
 * @description Verifies the offline/budget-exhausted fallback (HeuristicExtractionStrategy)
 * also extracts categorised learnings from scratchpad entries via LearningExtractor's existing
 * heuristics, with lessons_learned overlap deduplicated.
 */

import { assertEquals } from "@std/assert";

import { HeuristicExtractionStrategy } from "@exaix/memory";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import { LearningCategory } from "@exaix/core";

Deno.test("HeuristicExtractionStrategy extracts categorised learnings from scratchpad entries offline", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const scratchpad = new ExecutionMemoryStore(config);
    const traceId = crypto.randomUUID();
    await scratchpad.appendNote(traceId, "Avoid holding the file lock across await points");
    await scratchpad.appendNote(traceId, "Debug: the retry loop double-counts failures after a timeout fix");

    const strategy = new HeuristicExtractionStrategy(scratchpad);
    const learnings = await strategy.extract(createMinimalExecutionMemory({ trace_id: traceId }));

    assertEquals(learnings.length, 2);
    assertEquals(learnings[0].category, LearningCategory.ANTI_PATTERN);
    assertEquals(learnings[1].category, LearningCategory.TROUBLESHOOTING);
    assertEquals(learnings.every((l) => l.source_id === traceId), true);
  } finally {
    await cleanup();
  }
});

Deno.test("HeuristicExtractionStrategy deduplicates a scratchpad entry that repeats a lessons_learned entry", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const scratchpad = new ExecutionMemoryStore(config);
    const traceId = crypto.randomUUID();
    await scratchpad.appendNote(traceId, "Always validate portal mount paths before file writes");

    const strategy = new HeuristicExtractionStrategy(scratchpad);
    const learnings = await strategy.extract(createMinimalExecutionMemory({
      trace_id: traceId,
      lessons_learned: ["Always validate portal mount paths before file writes"],
    }));

    assertEquals(learnings.length, 1, "identical scratchpad + lessons_learned entries must yield one candidate");
  } finally {
    await cleanup();
  }
});

Deno.test("HeuristicExtractionStrategy without a scratchpad service behaves exactly as before", async () => {
  const strategy = new HeuristicExtractionStrategy();
  const learnings = await strategy.extract(createMinimalExecutionMemory({
    lessons_learned: ["Prefer explicit dependency injection over service-locator lookups"],
  }));
  assertEquals(learnings.length, 1);
});
