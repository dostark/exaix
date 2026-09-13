/**
 * @module DedupMetricTest
 * @path tests/scenario_framework/tests/unit/dedup_metric_test.ts
 * @description RED-first tests for Phase 148 Step 3's `computeDedupRate` — exact on
 * textbook cases — plus a real `MemoryBankService.supersedeLearning` seeded-corpus
 * check proving the metric reflects the real bank state after a genuine
 * Phase-147 consolidation call, not a synthetic count.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/consolidation_metrics.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { EventLogger } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";
import { MemoryBankService } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { createSampleLearning, initTestDbService } from "@exaix/testing";
import { MemoryStatus } from "@exaix/core/status";
import { computeDedupRate } from "../../runner/consolidation_metrics.ts";

Deno.test("[DedupRate] all near-duplicates removed scores 1.0", () => {
  assertEquals(computeDedupRate(2, 2), 1.0);
});

Deno.test("[DedupRate] some near-duplicates removed scores partial", () => {
  assertEquals(computeDedupRate(1, 2), 0.5);
});

Deno.test("[DedupRate] no near-duplicates removed scores 0", () => {
  assertEquals(computeDedupRate(0, 2), 0);
});

Deno.test("[DedupRate] throws when no near-duplicates were present — rate is undefined", () => {
  assertThrows(() => computeDedupRate(0, 0), Error, "near-duplicate");
});

Deno.test("[DedupRate] reflects the real bank state after a genuine supersedeLearning merge", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const config: Config = ConfigSchema.parse({
      system: { root: workspaceRoot },
      paths: {},
      database: {},
      watcher: {},
      agents: {},
      models: {},
      portals: [],
      mcp: {},
    });
    const { db, cleanup } = await initTestDbService();
    try {
      const logger = new EventLogger({ db, minLevel: LogLevel.FATAL });
      const memoryBank = new MemoryBankService(config, logger);

      const original: ILearning = createSampleLearning({
        id: "dddddddd-0000-4000-8000-000000000001",
        title: "Rate limiter capacity",
        description: "The rate limiter allows 100 requests per minute.",
        status: MemoryStatus.APPROVED,
      });
      await memoryBank.addGlobalLearning(original);

      const merged: ILearning = createSampleLearning({
        id: "dddddddd-0000-4000-8000-000000000002",
        title: "Rate limiter capacity (merged)",
        description: "The rate limiter allows 100 requests per minute via a token bucket.",
        status: MemoryStatus.APPROVED,
      });
      await memoryBank.supersedeLearning(original.id, merged, "near-duplicate merge");

      const globalMem = await memoryBank.getGlobalMemory();
      const nearDuplicatesPresent = 1;
      const duplicatesRemoved = globalMem!.learnings.filter((l) =>
        l.id === original.id && l.status === MemoryStatus.SUPERSEDED
      ).length;

      assertEquals(computeDedupRate(duplicatesRemoved, nearDuplicatesPresent), 1.0);
    } finally {
      await cleanup();
    }
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
