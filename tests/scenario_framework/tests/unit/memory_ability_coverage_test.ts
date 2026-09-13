/**
 * @module MemoryAbilityCoverageTest
 * @path tests/scenario_framework/tests/unit/memory_ability_coverage_test.ts
 * @description RED-first tests for Phase 148 Step 6's `assertMemoryAbilityCoverage` —
 * mirrors `artefact_catalog_test.ts`'s shape (a hand-built fixture tree plus a final
 * check against the real repo tree), not a "parity" test — Phase 142's own "parity"
 * is an unrelated ci-tier equivalence check (see this phase's pre-gap analysis GAP-3).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/memory_ability_coverage.ts, tests/scenario_framework/schema/memory_task_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { assertMemoryAbilityCoverage } from "../../runner/memory_ability_coverage.ts";

async function writeTask(root: string, id: string, ability: string): Promise<void> {
  const taskDir = join(root, id);
  await Deno.mkdir(taskDir, { recursive: true });
  await Deno.writeTextFile(
    join(taskDir, "task.json"),
    JSON.stringify({
      ability,
      session_writes: [{ id: "33333333-0000-4000-8000-000000000001", title: "x", content: "y" }],
      queries: [{
        text: "y",
        ground_truth_ids: ability === "abstention" ? [] : ["33333333-0000-4000-8000-000000000001"],
      }],
    }),
  );
}

Deno.test("[MemoryAbilityCoverage] a complete five-ability corpus has no missing abilities", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeTask(root, "t1", "information-extraction");
    await writeTask(root, "t2", "multi-session-reasoning");
    await writeTask(root, "t3", "temporal-reasoning");
    await writeTask(root, "t4", "knowledge-updates");
    await writeTask(root, "t5", "abstention");
    const result = await assertMemoryAbilityCoverage([root]);
    assertEquals(result.missing, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryAbilityCoverage] flags every ability with zero fixture coverage", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeTask(root, "t1", "information-extraction");
    const result = await assertMemoryAbilityCoverage([root]);
    assertEquals(
      result.missing.sort(),
      ["abstention", "knowledge-updates", "multi-session-reasoning", "temporal-reasoning"].sort(),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryAbilityCoverage] an empty corpus flags all five abilities missing", async () => {
  const root = await Deno.makeTempDir();
  try {
    const result = await assertMemoryAbilityCoverage([root]);
    assertEquals(result.missing.length, 5);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[MemoryAbilityCoverage] the real fixtures/memory corpus has all five abilities represented", async () => {
  const memoryFixturesDir = new URL("../../fixtures/memory", import.meta.url).pathname;
  const result = await assertMemoryAbilityCoverage([memoryFixturesDir]);
  assertEquals(result.missing, []);
});
