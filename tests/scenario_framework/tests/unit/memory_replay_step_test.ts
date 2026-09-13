/**
 * @module MemoryReplayStepTest
 * @path tests/scenario_framework/tests/unit/memory_replay_step_test.ts
 * @description RED-first tests for Phase 148 Step 1's `runMemoryReplay` — seeds a
 * sandboxed MemoryBankService with a memory task fixture's session writes as APPROVED
 * global learnings, issues the task's query through the real
 * SessionMemoryService.lookupMemories retrieval surface (keyword-only, no provider),
 * and returns the retrieved ids for recall@k scoring. Imports the script's exported
 * function directly, mirroring run_jailed_test.ts's convention of testing a scenario
 * script's core logic without spawning it as a subprocess.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/run_memory_replay.ts, tests/scenario_framework/runner/retrieval_metrics.ts, tests/scenario_framework/schema/memory_task_schema.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { runMemoryReplay } from "../../scripts/run_memory_replay.ts";
import { computeRecallAtK } from "../../runner/retrieval_metrics.ts";
import type { IMemoryTaskJson } from "../../schema/memory_task_schema.ts";

const EXEMPLAR_LEARNING_ID = "aaaaaaaa-0000-4000-8000-000000000001";

/** Mirrors fixtures/memory/info-extraction-basic/task.json exactly. */
const EXEMPLAR_TASK: IMemoryTaskJson = {
  ability: "information-extraction",
  session_writes: [
    {
      id: EXEMPLAR_LEARNING_ID,
      title: "Rate limiter reset behavior",
      content: "The rate limiter fully resets on a process restart, not on a per-request basis.",
    },
  ],
  queries: [
    {
      text: "rate limiter fully resets on a process restart",
      ground_truth_ids: [EXEMPLAR_LEARNING_ID],
      expected_answer: "The rate limiter resets on a full restart, not per request.",
    },
  ],
};

Deno.test("[MemoryReplayStep] seed→query→capture: retrieves the seeded learning's id via the real keyword-retrieval surface", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const result = await runMemoryReplay(workspaceRoot, EXEMPLAR_TASK);
    assertEquals(result.retrieved_ids, [EXEMPLAR_LEARNING_ID]);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[MemoryReplayStep] end-to-end: retrieved ids score a perfect recall@k against the fixture's own ground truth", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const result = await runMemoryReplay(workspaceRoot, EXEMPLAR_TASK);
    const score = computeRecallAtK(result.retrieved_ids, EXEMPLAR_TASK.queries[0].ground_truth_ids, 5);
    assertEquals(score, 1.0);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[MemoryReplayStep] is deterministic — two independent runs on fresh workspaces agree", async () => {
  const workspaceRootA = await Deno.makeTempDir();
  const workspaceRootB = await Deno.makeTempDir();
  try {
    const resultA = await runMemoryReplay(workspaceRootA, EXEMPLAR_TASK);
    const resultB = await runMemoryReplay(workspaceRootB, EXEMPLAR_TASK);
    assertEquals(resultA.retrieved_ids, resultB.retrieved_ids);
  } finally {
    await Deno.remove(workspaceRootA, { recursive: true });
    await Deno.remove(workspaceRootB, { recursive: true });
  }
});

Deno.test("[MemoryReplayStep] a query with no relevant memory seeded retrieves nothing (no fabrication)", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const unrelatedQueryTask: IMemoryTaskJson = {
      ...EXEMPLAR_TASK,
      queries: [{ text: "a completely unrelated fact never mentioned anywhere", ground_truth_ids: [] }],
    };
    const result = await runMemoryReplay(workspaceRoot, unrelatedQueryTask);
    assertEquals(result.retrieved_ids, []);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[MemoryReplayStep] throws a clear error when queryIndex is out of range", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => runMemoryReplay(workspaceRoot, EXEMPLAR_TASK, 5),
      Error,
      "no query at index 5",
    );
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
