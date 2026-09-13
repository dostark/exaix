/**
 * @module MemoryStalenessCheckScriptTest
 * @path tests/scenario_framework/tests/unit/memory_staleness_check_script_test.ts
 * @description RED-first tests for Phase 148 Step 6's `runMemoryStalenessCheck` —
 * confirms a genuine supersede against a real `MemoryBankService` retrieves the current
 * fact and excludes the retired one. This is the production call site for
 * `computeStalenessCorrect` (Step 3), distinct from its own unit tests.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/run_memory_staleness_check.ts, tests/scenario_framework/runner/consolidation_metrics.ts]
 */

import { assertEquals } from "@std/assert";
import { runMemoryStalenessCheck } from "../../scripts/run_memory_staleness_check.ts";

Deno.test("[MemoryStalenessCheckScript] retrieves the current fact and excludes the retired one", async () => {
  const workspaceRoot = await Deno.makeTempDir();
  try {
    const result = await runMemoryStalenessCheck(workspaceRoot);
    assertEquals(result.retrieved_ids, ["57a1e000-0000-4000-8000-000000000002"]);
    assertEquals(result.staleness_correct, 1);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("[MemoryStalenessCheckScript] is deterministic — two independent runs on fresh workspaces agree", async () => {
  const workspaceRootA = await Deno.makeTempDir();
  const workspaceRootB = await Deno.makeTempDir();
  try {
    const resultA = await runMemoryStalenessCheck(workspaceRootA);
    const resultB = await runMemoryStalenessCheck(workspaceRootB);
    assertEquals(resultA, resultB);
  } finally {
    await Deno.remove(workspaceRootA, { recursive: true });
    await Deno.remove(workspaceRootB, { recursive: true });
  }
});
