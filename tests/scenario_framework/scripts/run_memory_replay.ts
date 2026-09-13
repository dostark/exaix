#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunMemoryReplay
 * @path tests/scenario_framework/scripts/run_memory_replay.ts
 * @description Memory-replay driver: seeds a sandboxed MemoryBankService with a memory
 * task fixture's session writes (as APPROVED global learnings), issues the task's query
 * through the real SessionMemoryService.lookupMemories retrieval surface (keyword-only —
 * embeddingService is a no-op stub so the run is deterministic and provider-free), and
 * prints the retrieved memory ids as JSON for scoring by the `recall-at-k` criterion.
 * @architectural-layer Test
 * @dependencies [packages/memory]
 * @related-files [tests/scenario_framework/tests/unit/memory_replay_step_test.ts, tests/scenario_framework/schema/memory_task_schema.ts, tests/scenario_framework/runner/retrieval_metrics.ts]
 */

import { EventLogger } from "@exaix/core/logger";
import { MemoryBankService, SessionMemoryService } from "@exaix/memory";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { ConfidenceAssessmentLevel, LearningCategory, LogLevel, MemoryBankSource, MemoryScope } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { castAny, createSampleLearning, initTestDbService } from "@exaix/testing";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import { MemoryTaskJsonSchema } from "../schema/memory_task_schema.ts";
import type { IMemoryTaskJson } from "../schema/memory_task_schema.ts";

export interface IMemoryReplayResult {
  retrieved_ids: string[];
}

const LEARNING_SOURCE_PREFIX = "learning:";

/** Retrieval runs the keyword-only path deterministically — no vector signal, no provider. */
const NOOP_EMBEDDING_SERVICE = castAny<IMemoryEmbeddingService>({
  searchByEmbedding: () => Promise.resolve([]),
  embed: () => Promise.resolve(),
  embedLearning: () => Promise.resolve(),
  initializeManifest: () => Promise.resolve(),
});

/** Seeds `task`'s session writes as APPROVED global learnings, then issues the query at
 * `queryIndex` (default 0) through the real, unmocked `lookupMemories` keyword-retrieval
 * surface. */
export async function runMemoryReplay(
  workspaceRoot: string,
  task: IMemoryTaskJson,
  queryIndex = 0,
): Promise<IMemoryReplayResult> {
  const query = task.queries[queryIndex];
  if (!query) throw new Error(`task has no query at index ${queryIndex}`);

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
    // FATAL-only: the recall-at-k criterion parses this process's entire stdout as JSON,
    // so default INFO-level console logging would corrupt that parse.
    const logger = new EventLogger({ db, minLevel: LogLevel.FATAL });
    const memoryBank = new MemoryBankService(config, logger);
    for (const write of task.session_writes) {
      const learning: ILearning = createSampleLearning({
        id: write.id,
        title: write.title,
        description: write.content,
        scope: MemoryScope.GLOBAL,
        project: undefined,
        status: MemoryStatus.APPROVED,
        category: LearningCategory.INSIGHT,
        confidence: ConfidenceAssessmentLevel.HIGH,
        source: MemoryBankSource.EXECUTION,
      });
      await memoryBank.addGlobalLearning(learning);
    }

    const sessionMemory = new SessionMemoryService(memoryBank, NOOP_EMBEDDING_SERVICE);
    const memories = await sessionMemory.lookupMemories(query.text);
    const retrievedIds = memories
      .map((memory) => memory.source)
      .filter((source): source is string => typeof source === "string" && source.startsWith(LEARNING_SOURCE_PREFIX))
      .map((source) => source.slice(LEARNING_SOURCE_PREFIX.length));

    return { retrieved_ids: retrievedIds };
  } finally {
    await cleanup();
  }
}

function usageError(): never {
  console.error("Usage: run_memory_replay.ts <workspace-root> <task-json-path> [query-index]");
  Deno.exit(1);
}

if (import.meta.main) {
  const workspaceRoot = Deno.args[0];
  const taskJsonPath = Deno.args[1];
  if (!workspaceRoot || !taskJsonPath) usageError();
  const queryIndex = Deno.args[2] ? Number(Deno.args[2]) : 0;
  const raw = JSON.parse(await Deno.readTextFile(taskJsonPath));
  const task = MemoryTaskJsonSchema.parse(raw);
  const result = await runMemoryReplay(workspaceRoot, task, queryIndex);
  console.log(JSON.stringify(result));
}
