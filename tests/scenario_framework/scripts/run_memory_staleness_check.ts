#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunMemoryStalenessCheck
 * @path tests/scenario_framework/scripts/run_memory_staleness_check.ts
 * @description Staleness driver: seeds a "retired" learning, supersedes it with a
 * "current" one via the real `MemoryBankService.supersedeLearning`, issues the task's
 * query through the real `SessionMemoryService.lookupMemories` retrieval surface, and
 * scores the retrieved ids with Step 3's `computeStalenessCorrect` — proving retrieval
 * both surfaces the current fact and excludes the retired one. Sibling of
 * `run_memory_replay.ts`; a real production call site for `computeStalenessCorrect`,
 * distinct from its own unit tests.
 * @architectural-layer Test
 * @dependencies [packages/memory]
 * @related-files [tests/scenario_framework/runner/consolidation_metrics.ts, tests/scenario_framework/tests/unit/staleness_metric_test.ts, tests/scenario_framework/scripts/run_memory_replay.ts]
 */

import { EventLogger } from "@exaix/core/logger";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { ConfidenceAssessmentLevel, LearningCategory, LogLevel, MemoryBankSource, MemoryScope } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { computeStalenessCorrect } from "../runner/consolidation_metrics.ts";

export interface IStalenessCheckResult {
  retrieved_ids: string[];
  staleness_correct: number;
}

const RETIRED_LEARNING_ID = "57a1e000-0000-4000-8000-000000000001";
const CURRENT_LEARNING_ID = "57a1e000-0000-4000-8000-000000000002";
const SUPERSEDE_REASON = "staleness-check: fact updated";
const QUERY_TEXT = "maximum file upload size";

/** Retrieval runs the keyword-only path deterministically — no vector signal, no provider. */
const NOOP_EMBEDDING_SERVICE = castAny<IMemoryEmbeddingService>({
  searchByEmbedding: () => Promise.resolve([]),
  embed: () => Promise.resolve(),
  embedLearning: () => Promise.resolve(),
  initializeManifest: () => Promise.resolve(),
});

export async function runMemoryStalenessCheck(workspaceRoot: string): Promise<IStalenessCheckResult> {
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

    const retired = createSampleLearning({
      id: RETIRED_LEARNING_ID,
      title: "Maximum file upload size",
      description: "The maximum file upload size is 10MB.",
      scope: MemoryScope.GLOBAL,
      project: undefined,
      status: MemoryStatus.APPROVED,
      category: LearningCategory.INSIGHT,
      confidence: ConfidenceAssessmentLevel.HIGH,
      source: MemoryBankSource.EXECUTION,
    });
    await memoryBank.addGlobalLearning(retired);
    const current = createSampleLearning({
      id: CURRENT_LEARNING_ID,
      title: "Maximum file upload size (updated)",
      description: "The maximum file upload size is now 50MB, up from the previous 10MB limit.",
      scope: MemoryScope.GLOBAL,
      project: undefined,
      status: MemoryStatus.APPROVED,
      category: LearningCategory.INSIGHT,
      confidence: ConfidenceAssessmentLevel.HIGH,
      source: MemoryBankSource.EXECUTION,
    });
    await memoryBank.supersedeLearning(retired.id, current, SUPERSEDE_REASON);

    const sessionMemory = new SessionMemoryService(memoryBank, NOOP_EMBEDDING_SERVICE);
    const memories = await sessionMemory.lookupMemories(QUERY_TEXT);
    const learningPrefix = "learning:";
    const retrievedIds = memories
      .filter((memory): memory is typeof memory & { source: string } =>
        typeof memory.source === "string" && memory.source.startsWith(learningPrefix)
      )
      .map((memory) => memory.source.slice(learningPrefix.length));

    const stalenessCorrect = computeStalenessCorrect(retrievedIds, CURRENT_LEARNING_ID, [RETIRED_LEARNING_ID]);
    return { retrieved_ids: retrievedIds, staleness_correct: stalenessCorrect };
  } finally {
    await cleanup();
  }
}

if (import.meta.main) {
  const workspaceRoot = Deno.args[0];
  if (!workspaceRoot) {
    console.error("Usage: run_memory_staleness_check.ts <workspace-root>");
    Deno.exit(1);
  }
  const result = await runMemoryStalenessCheck(workspaceRoot);
  console.log(JSON.stringify(result));
}
