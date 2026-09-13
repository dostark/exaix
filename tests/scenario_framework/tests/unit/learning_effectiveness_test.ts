/**
 * @module LearningEffectivenessTest
 * @path tests/scenario_framework/tests/unit/learning_effectiveness_test.ts
 * @description RED-first tests for Phase 148 Step 4's `runLearningEffectiveness` —
 * warm-minus-cold computed exactly on seeded cold/warm runs. Cold uses a fresh empty
 * workspace (nothing can possibly be retrieved); warm runs task A's lesson through the
 * real, LLM-free MemoryExtractorService + HeuristicExtractionStrategy +
 * MemoryAutoApprovalService pipeline (Phase 147 S1/S6), then queries task B's text.
 * Deterministic and token-free — no provider involved.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/run_learning_effectiveness.ts, tests/scenario_framework/runner/retrieval_metrics.ts]
 */

import { assertEquals } from "@std/assert";
import { runLearningEffectiveness } from "../../scripts/run_learning_effectiveness.ts";

Deno.test("[LearningEffectiveness] positive when a related fact learned from task A helps retrieve task B's query", async () => {
  const coldRoot = await Deno.makeTempDir();
  const warmRoot = await Deno.makeTempDir();
  try {
    const result = await runLearningEffectiveness(
      coldRoot,
      warmRoot,
      ["The rate limiter fully resets on a process restart, not on a per-request basis."],
      "rate limiter fully resets on a process restart",
    );
    assertEquals(result.cold_recall, 0);
    assertEquals(result.warm_recall, 1);
    assertEquals(result.learning_effectiveness, 1);
  } finally {
    await Deno.remove(coldRoot, { recursive: true });
    await Deno.remove(warmRoot, { recursive: true });
  }
});

Deno.test("[LearningEffectiveness] ~0 when task B's query is unrelated to anything task A taught", async () => {
  const coldRoot = await Deno.makeTempDir();
  const warmRoot = await Deno.makeTempDir();
  try {
    const result = await runLearningEffectiveness(
      coldRoot,
      warmRoot,
      ["The rate limiter fully resets on a process restart, not on a per-request basis."],
      "a completely unrelated fact never mentioned anywhere",
    );
    assertEquals(result.cold_recall, 0);
    assertEquals(result.warm_recall, 0);
    assertEquals(result.learning_effectiveness, 0);
  } finally {
    await Deno.remove(coldRoot, { recursive: true });
    await Deno.remove(warmRoot, { recursive: true });
  }
});

Deno.test("[LearningEffectiveness] cold is always 0 — nothing exists in an empty workspace to retrieve", async () => {
  const coldRoot = await Deno.makeTempDir();
  const warmRoot = await Deno.makeTempDir();
  try {
    const result = await runLearningEffectiveness(
      coldRoot,
      warmRoot,
      ["Always validate portal mount paths before writing files to disk."],
      "validate portal mount paths before writing files",
    );
    assertEquals(result.cold_recall, 0);
  } finally {
    await Deno.remove(coldRoot, { recursive: true });
    await Deno.remove(warmRoot, { recursive: true });
  }
});
