#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunMemoryConsolidationCheck
 * @path tests/scenario_framework/scripts/run_memory_consolidation_check.ts
 * @description Consolidation-quality driver: performs one explicit dedup-merge
 * (`supersedeLearning`) and one explicit contradiction-update (`updateLearning`) against
 * a real `MemoryBankService`, observes the resulting store state, and scores it with the
 * Step 3 `consolidation_metrics.ts` pure functions. Prints the result as JSON for scoring
 * by `json-query` criteria — sibling of `run_memory_replay.ts`.
 * @architectural-layer Test
 * @dependencies [packages/memory]
 * @related-files [tests/scenario_framework/runner/consolidation_metrics.ts, tests/scenario_framework/tests/unit/dedup_metric_test.ts, tests/scenario_framework/tests/unit/contradiction_metric_test.ts]
 */

import { EventLogger } from "@exaix/core/logger";
import { MemoryBankService } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { ConfidenceAssessmentLevel, LearningCategory, LogLevel, MemoryBankSource, MemoryScope } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { createSampleLearning, initTestDbService } from "@exaix/testing";
import { computeContradictionCorrect, computeDedupRate } from "../runner/consolidation_metrics.ts";

export interface IConsolidationCheckResult {
  dedup_rate: number;
  contradiction_correct: number;
}

const DEDUP_ORIGINAL_ID = "dedeed00-0000-4000-8000-000000000001";
const DEDUP_MERGED_ID = "dedeed00-0000-4000-8000-000000000002";
const DEDUP_MERGE_REASON = "consolidation-check: near-duplicate merge";
const CONTRADICTION_LEARNING_ID = "c0ffee00-0000-4000-8000-000000000001";
const CONTRADICTION_CORRECTED_DESCRIPTION = "The API rate limit is 500 requests per minute.";

/** Merges one near-duplicate pair and corrects one stale fact against a real
 * `MemoryBankService`, then scores the resulting store state. */
export async function runMemoryConsolidationCheck(workspaceRoot: string): Promise<IConsolidationCheckResult> {
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

    const original = createSampleLearning({
      id: DEDUP_ORIGINAL_ID,
      title: "Rate limiter uses token bucket",
      description: "The rate limiter implementation uses a token bucket algorithm.",
      scope: MemoryScope.GLOBAL,
      project: undefined,
      status: MemoryStatus.APPROVED,
      category: LearningCategory.INSIGHT,
      confidence: ConfidenceAssessmentLevel.HIGH,
      source: MemoryBankSource.EXECUTION,
    });
    await memoryBank.addGlobalLearning(original);
    const merged = createSampleLearning({
      id: DEDUP_MERGED_ID,
      title: "Rate limiter uses token bucket (merged)",
      description: "The rate limiter implementation uses a token bucket algorithm.",
      scope: MemoryScope.GLOBAL,
      project: undefined,
      status: MemoryStatus.APPROVED,
      category: LearningCategory.INSIGHT,
      confidence: ConfidenceAssessmentLevel.HIGH,
      source: MemoryBankSource.EXECUTION,
    });
    await memoryBank.supersedeLearning(original.id, merged, DEDUP_MERGE_REASON);
    const afterDedup = await memoryBank.getGlobalMemory();
    const originalSuperseded = afterDedup?.learnings.find((learning) =>
      learning.id === original.id
    )?.status === MemoryStatus.SUPERSEDED;
    const dedupRate = computeDedupRate(originalSuperseded ? 1 : 0, 1);

    const stale = createSampleLearning({
      id: CONTRADICTION_LEARNING_ID,
      title: "API rate limit",
      description: "The API rate limit is 100 requests per minute.",
      scope: MemoryScope.GLOBAL,
      project: undefined,
      status: MemoryStatus.APPROVED,
      category: LearningCategory.INSIGHT,
      confidence: ConfidenceAssessmentLevel.HIGH,
      source: MemoryBankSource.EXECUTION,
    });
    await memoryBank.addGlobalLearning(stale);
    await memoryBank.updateLearning(stale.id, { description: CONTRADICTION_CORRECTED_DESCRIPTION });
    const afterUpdate = await memoryBank.getGlobalMemory();
    const updateCorrect = afterUpdate?.learnings.find((learning) => learning.id === stale.id)?.description ===
      CONTRADICTION_CORRECTED_DESCRIPTION;
    const contradictionCorrect = computeContradictionCorrect([updateCorrect ?? false]);

    return { dedup_rate: dedupRate, contradiction_correct: contradictionCorrect };
  } finally {
    await cleanup();
  }
}

if (import.meta.main) {
  const workspaceRoot = Deno.args[0];
  if (!workspaceRoot) {
    console.error("Usage: run_memory_consolidation_check.ts <workspace-root>");
    Deno.exit(1);
  }
  const result = await runMemoryConsolidationCheck(workspaceRoot);
  console.log(JSON.stringify(result));
}
