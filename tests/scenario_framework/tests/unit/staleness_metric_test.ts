/**
 * @module StalenessMetricTest
 * @path tests/scenario_framework/tests/unit/staleness_metric_test.ts
 * @description RED-first tests for Phase 148 Step 3's `computeStalenessCorrect` —
 * exact on textbook cases — plus a real seed→supersede→query check proving retrieval
 * genuinely prefers the current fact over a retired one: a real `supersedeLearning`
 * call, then the real `SessionMemoryService.lookupMemories` keyword-retrieval surface
 * (Step 1's exemplar path), confirming the retired id never surfaces because
 * memory_search.ts's keyword search already excludes non-APPROVED learnings.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/consolidation_metrics.ts, tests/scenario_framework/scripts/run_memory_replay.ts]
 */

import { assertEquals } from "@std/assert";
import { EventLogger } from "@exaix/core/logger";
import { LogLevel, MemoryBankSource, MemoryScope } from "@exaix/core";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";
import { MemoryStatus } from "@exaix/core/status";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { computeStalenessCorrect } from "../../runner/consolidation_metrics.ts";

const NOOP_EMBEDDING_SERVICE = castAny<IMemoryEmbeddingService>({
  searchByEmbedding: () => Promise.resolve([]),
  embed: () => Promise.resolve(),
  embedLearning: () => Promise.resolve(),
  initializeManifest: () => Promise.resolve(),
});

Deno.test("[StalenessCorrect] current retrieved, no retired ids present scores 1", () => {
  assertEquals(computeStalenessCorrect(["current"], "current", ["retired"]), 1);
});

Deno.test("[StalenessCorrect] retired id still surfaces alongside current — scores 0 (contaminated)", () => {
  assertEquals(computeStalenessCorrect(["current", "retired"], "current", ["retired"]), 0);
});

Deno.test("[StalenessCorrect] current fact missing entirely scores 0", () => {
  assertEquals(computeStalenessCorrect(["retired"], "current", ["retired"]), 0);
});

Deno.test("[StalenessCorrect] reflects real retrieval after a genuine supersedeLearning call — the retired id is excluded", async () => {
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

      const retired: ILearning = createSampleLearning({
        id: "ffffffff-0000-4000-8000-000000000001",
        title: "Rate limiter reset behavior",
        description: "The rate limiter resets every hour on a fixed schedule.",
        scope: MemoryScope.GLOBAL,
        project: undefined,
        status: MemoryStatus.APPROVED,
        source: MemoryBankSource.EXECUTION,
      });
      await memoryBank.addGlobalLearning(retired);

      const current: ILearning = createSampleLearning({
        id: "ffffffff-0000-4000-8000-000000000002",
        title: "Rate limiter reset behavior (corrected)",
        description: "The rate limiter fully resets on a process restart, not on a fixed schedule.",
        scope: MemoryScope.GLOBAL,
        project: undefined,
        status: MemoryStatus.APPROVED,
        source: MemoryBankSource.EXECUTION,
      });
      await memoryBank.supersedeLearning(retired.id, current, "knowledge update: schedule-based claim was wrong");

      const sessionMemory = new SessionMemoryService(memoryBank, NOOP_EMBEDDING_SERVICE);
      const memories = await sessionMemory.lookupMemories("rate limiter fully resets on a process restart");
      const retrievedIds = memories
        .map((memory) => memory.source)
        .filter((source): source is string => typeof source === "string" && source.startsWith("learning:"))
        .map((source) => source.slice("learning:".length));

      assertEquals(computeStalenessCorrect(retrievedIds, current.id, [retired.id]), 1);
    } finally {
      await cleanup();
    }
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
