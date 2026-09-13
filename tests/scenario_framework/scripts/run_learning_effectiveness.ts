#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunLearningEffectiveness
 * @path tests/scenario_framework/scripts/run_learning_effectiveness.ts
 * @description Phase 148 Step 4 learning-effectiveness (warm minus cold) driver.
 * Cold: a fresh, unseeded workspace queries task B's text directly — nothing can
 * possibly be retrieved. Warm: a SEPARATE fresh workspace runs task A's lesson
 * through the real MemoryExtractorService + HeuristicExtractionStrategy +
 * MemoryAutoApprovalService pipeline (Phase 147 S1/S6, the same LLM-free path
 * run_memory_full_loop.ts exercises), then queries task B's text through the real
 * SessionMemoryService.lookupMemories surface. `learning_effectiveness` is
 * warm_recall_at_k minus cold_recall_at_k against the freshly-extracted learning's
 * own id (unknowable in advance — captured from analyzeExecution's return value).
 * @architectural-layer Test
 * @dependencies [packages/memory]
 * @related-files [tests/scenario_framework/tests/unit/learning_effectiveness_test.ts, tests/scenario_framework/runner/retrieval_metrics.ts, tests/scenario_framework/scripts/run_memory_replay.ts]
 */

import { EventLogger } from "@exaix/core/logger";
import { LogLevel, MemoryScope } from "@exaix/core";
import {
  HeuristicExtractionStrategy,
  MemoryAutoApprovalService,
  MemoryBankService,
  SessionMemoryService,
} from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { castAny, createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import type { IExtractionStrategy, IMemoryCostRouter, IMemoryEmbeddingService } from "@exaix/core/types";
import { computeRecallAtK } from "../runner/retrieval_metrics.ts";
import { MemoryExtractorService } from "@exaix/memory";

export interface ILearningEffectivenessResult {
  extracted_learning_id: string;
  cold_recall: number;
  warm_recall: number;
  learning_effectiveness: number;
}

const LEARNING_SOURCE_PREFIX = "learning:";
const BACKDATE_HOURS = 2;
const DEFAULT_K = 5;

const NOOP_EMBEDDING_SERVICE = castAny<IMemoryEmbeddingService>({
  searchByEmbedding: () => Promise.resolve([]),
  embed: () => Promise.resolve(),
  embedLearning: () => Promise.resolve(),
  initializeManifest: () => Promise.resolve(),
});

const NOOP_COST_ROUTER = castAny<IMemoryCostRouter>({
  isRemoteAllowed: () => Promise.resolve(false),
  recordOperation: () => Promise.resolve(),
});

function buildConfig(workspaceRoot: string): Config {
  return ConfigSchema.parse({
    system: { root: workspaceRoot },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
    memory: { auto_approve: { enabled: true, delay_hours: 1, confidence_threshold: "medium" } },
  });
}

function extractLearningIds(memories: Array<{ source?: string }>): string[] {
  return memories
    .map((memory) => memory.source)
    .filter((source): source is string => typeof source === "string" && source.startsWith(LEARNING_SOURCE_PREFIX))
    .map((source) => source.slice(LEARNING_SOURCE_PREFIX.length));
}

/** Baseline: an empty workspace can never retrieve anything relevant to task B. */
async function runCold(workspaceRoot: string, taskBQuery: string): Promise<string[]> {
  const config = buildConfig(workspaceRoot);
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db, minLevel: LogLevel.FATAL });
    const memoryBank = new MemoryBankService(config, logger);
    const sessionMemory = new SessionMemoryService(memoryBank, NOOP_EMBEDDING_SERVICE);
    const memories = await sessionMemory.lookupMemories(taskBQuery);
    return extractLearningIds(memories);
  } finally {
    await cleanup();
  }
}

/** Runs task A's lesson through the real extraction+approval pipeline, then queries
 * task B's text. Returns the freshly-extracted learning's id (for scoring against) and
 * the ids task B's query retrieved. */
async function runWarm(
  workspaceRoot: string,
  taskALessonsLearned: string[],
  taskBQuery: string,
  extractionStrategy: IExtractionStrategy,
): Promise<{ extractedLearningId: string; retrievedIds: string[] }> {
  const config = buildConfig(workspaceRoot);
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db, minLevel: LogLevel.FATAL });
    const memoryBank = new MemoryBankService(config, logger);
    const executionMemory = createMinimalExecutionMemory({ lessons_learned: taskALessonsLearned });

    const extractor = new MemoryExtractorService(config, db, memoryBank, logger, {
      costRouter: NOOP_COST_ROUTER,
      heuristicStrategy: extractionStrategy,
    });
    const candidates = await extractor.analyzeExecution(executionMemory);
    if (candidates.length === 0) {
      throw new Error("extraction produced no candidates from task A's lessons_learned");
    }
    const extractedLearningId = candidates[0].id;
    const backdated = new Date(Date.now() - BACKDATE_HOURS * 60 * 60 * 1000).toISOString();
    for (const candidate of candidates) {
      candidate.scope = MemoryScope.GLOBAL;
      candidate.project = undefined;
      candidate.extracted_at = backdated;
      await extractor.createProposal(candidate, executionMemory, "phase148-learning-effectiveness");
    }

    const autoApprovalService = new MemoryAutoApprovalService(config, extractor);
    const approvalResult = await autoApprovalService.runApprovalCycle();
    if (approvalResult.promoted.length === 0) throw new Error("auto-approval promoted nothing");

    const sessionMemory = new SessionMemoryService(memoryBank, NOOP_EMBEDDING_SERVICE);
    const memories = await sessionMemory.lookupMemories(taskBQuery);
    return { extractedLearningId, retrievedIds: extractLearningIds(memories) };
  } finally {
    await cleanup();
  }
}

/** `coldWorkspaceRoot`/`warmWorkspaceRoot` must be two SEPARATE fresh temp dirs.
 * Defaults to the LLM-free `HeuristicExtractionStrategy`; pass an LLM-backed one for the live leg. */
export async function runLearningEffectiveness(
  coldWorkspaceRoot: string,
  warmWorkspaceRoot: string,
  taskALessonsLearned: string[],
  taskBQuery: string,
  k = DEFAULT_K,
  extractionStrategy: IExtractionStrategy = new HeuristicExtractionStrategy(),
): Promise<ILearningEffectivenessResult> {
  const { extractedLearningId, retrievedIds: warmRetrievedIds } = await runWarm(
    warmWorkspaceRoot,
    taskALessonsLearned,
    taskBQuery,
    extractionStrategy,
  );
  const coldRetrievedIds = await runCold(coldWorkspaceRoot, taskBQuery);

  const coldRecall = computeRecallAtK(coldRetrievedIds, [extractedLearningId], k);
  const warmRecall = computeRecallAtK(warmRetrievedIds, [extractedLearningId], k);

  return {
    extracted_learning_id: extractedLearningId,
    cold_recall: coldRecall,
    warm_recall: warmRecall,
    learning_effectiveness: warmRecall - coldRecall,
  };
}

function usageError(): never {
  console.error(
    "Usage: run_learning_effectiveness.ts <cold-workspace-root> <warm-workspace-root> <task-a-lesson> <task-b-query>",
  );
  Deno.exit(1);
}

if (import.meta.main) {
  const coldRoot = Deno.args[0];
  const warmRoot = Deno.args[1];
  const taskALesson = Deno.args[2];
  const taskBQuery = Deno.args[3];
  if (!coldRoot || !warmRoot || !taskALesson || !taskBQuery) usageError();
  const result = await runLearningEffectiveness(coldRoot, warmRoot, [taskALesson], taskBQuery);
  console.log(JSON.stringify(result));
}
