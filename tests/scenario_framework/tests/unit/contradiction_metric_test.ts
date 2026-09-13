/**
 * @module ContradictionMetricTest
 * @path tests/scenario_framework/tests/unit/contradiction_metric_test.ts
 * @description RED-first tests for Phase 148 Step 3's `computeContradictionCorrect` —
 * exact on textbook cases — plus real `MemoryBankService.updateLearning`/
 * `supersedeLearning` seeded-conflict checks proving the metric reflects the real
 * bank state after genuine Phase-147 consolidation calls. Per this step's Actions,
 * WHICH operation applies to which learning is fixed in the fixture/test itself
 * (no LLM contradiction-resolver involved), so scoring stays deterministic.
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
import { computeContradictionCorrect } from "../../runner/consolidation_metrics.ts";

Deno.test("[ContradictionCorrect] every case ending correctly scores 1.0", () => {
  assertEquals(computeContradictionCorrect([true, true, true]), 1.0);
});

Deno.test("[ContradictionCorrect] some cases ending incorrectly scores partial", () => {
  assertEquals(computeContradictionCorrect([true, false]), 0.5);
});

Deno.test("[ContradictionCorrect] every case ending incorrectly scores 0", () => {
  assertEquals(computeContradictionCorrect([false, false]), 0);
});

Deno.test("[ContradictionCorrect] throws on an empty outcome list — correctness is undefined", () => {
  assertThrows(() => computeContradictionCorrect([]), Error, "outcome");
});

Deno.test("[ContradictionCorrect] reflects the real bank state after a genuine updateLearning + supersedeLearning pair", async () => {
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

      // Case 1: UPDATE — a stale capacity figure is corrected in place.
      const updateTarget: ILearning = createSampleLearning({
        id: "eeeeeeee-0000-4000-8000-000000000001",
        title: "Rate limiter capacity",
        description: "The rate limiter allows 50 requests per minute.",
        status: MemoryStatus.APPROVED,
      });
      await memoryBank.addGlobalLearning(updateTarget);
      await memoryBank.updateLearning(updateTarget.id, {
        description: "The rate limiter allows 100 requests per minute.",
      });

      // Case 2: SUPERSEDE — a retired fact is replaced by a new learning.
      const supersedeTarget: ILearning = createSampleLearning({
        id: "eeeeeeee-0000-4000-8000-000000000002",
        title: "Rate limiter reset behavior",
        description: "The rate limiter resets every hour.",
        status: MemoryStatus.APPROVED,
      });
      await memoryBank.addGlobalLearning(supersedeTarget);
      const replacement: ILearning = createSampleLearning({
        id: "eeeeeeee-0000-4000-8000-000000000003",
        title: "Rate limiter reset behavior (corrected)",
        description: "The rate limiter fully resets on a process restart, not on a schedule.",
        status: MemoryStatus.APPROVED,
      });
      await memoryBank.supersedeLearning(
        supersedeTarget.id,
        replacement,
        "contradiction: was scheduled, is restart-based",
      );

      const globalMem = await memoryBank.getGlobalMemory();
      const updated = globalMem!.learnings.find((l) => l.id === updateTarget.id);
      const updateCorrect = updated?.description === "The rate limiter allows 100 requests per minute.";

      const superseded = globalMem!.learnings.find((l) => l.id === supersedeTarget.id);
      const supersedeCorrect = superseded?.status === MemoryStatus.SUPERSEDED &&
        superseded.superseded_by === replacement.id;

      assertEquals(computeContradictionCorrect([updateCorrect, supersedeCorrect]), 1.0);
    } finally {
      await cleanup();
    }
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
