/**
 * @module MemoryConsolidationCheckScriptTest
 * @path tests/scenario_framework/tests/unit/memory_consolidation_check_script_test.ts
 * @description RED-first tests for Phase 148 Step 6's `runMemoryConsolidationCheck` —
 * confirms the script's explicit dedup-merge and contradiction-update against a real
 * `MemoryBankService` produce a correctly-scored, deterministic result. This is the
 * production call site for `computeDedupRate`/`computeContradictionCorrect` (Step 3),
 * distinct from those functions' own unit tests.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/run_memory_consolidation_check.ts, tests/scenario_framework/runner/consolidation_metrics.ts]
 */

import { assertEquals } from "@std/assert";
import { runMemoryConsolidationCheck } from "../../scripts/run_memory_consolidation_check.ts";

Deno.test("[MemoryConsolidationCheckScript] a genuine near-duplicate merge scores dedup_rate 1", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const result = await runMemoryConsolidationCheck(workspaceRoot);
    assertEquals(result.dedup_rate, 1);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[MemoryConsolidationCheckScript] a genuine contradiction-update scores contradiction_correct 1", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const result = await runMemoryConsolidationCheck(workspaceRoot);
    assertEquals(result.contradiction_correct, 1);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[MemoryConsolidationCheckScript] is deterministic — two independent runs on fresh workspaces agree", async () => {
  const workspaceRootA = await Deno.makeTempDir();
  const workspaceRootB = await Deno.makeTempDir();
  try {
    const resultA = await runMemoryConsolidationCheck(workspaceRootA);
    const resultB = await runMemoryConsolidationCheck(workspaceRootB);
    assertEquals(resultA, resultB);
  } finally {
    await Deno.remove(workspaceRootA, { recursive: true });
    await Deno.remove(workspaceRootB, { recursive: true });
  }
});
