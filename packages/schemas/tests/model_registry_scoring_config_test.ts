/**
 * @module ModelRegistryScoringConfigTest
 * @path packages/schemas/tests/model_registry_scoring_config_test.ts
 * @description Phase 135 Step 8 (GAP-B) — validates the scoring config surface
 *   ModelRegistryConfigSchema gains: benchmark_map (task-type → ranking benchmarks),
 *   task_type_map (entity name → TaskType soft-match), usage_tiebreak (F8 opt-in).
 *   Canonical TaskType keys only (G7) — non-canonical keys must be rejected.
 * @architectural-layer Shared
 * @dependencies [@std/assert, @exaix/schemas, @exaix/core]
 */
import { assertEquals, assertThrows } from "@std/assert";
import { TaskType } from "@exaix/core";
import { ModelRegistryConfigSchema } from "../src/config.ts";

Deno.test("[step135.8] benchmark_map default resolves refactor and analysis multi-benchmark keying (GAP-B)", () => {
  const parsed = ModelRegistryConfigSchema.parse({});

  assertEquals(parsed!.benchmark_map.feature, ["swe_bench_verified"]);
  assertEquals(parsed!.benchmark_map.bugfix, ["swe_bench_verified"]);
  assertEquals(parsed!.benchmark_map.refactor, ["swe_bench_verified", "swe_bench_pro"]);
  assertEquals(parsed!.benchmark_map.test, ["swe_bench_verified"]);
  assertEquals(parsed!.benchmark_map.analysis, ["gpqa"]);
});

Deno.test("[step135.8] task_type_map defaults to empty; usage_tiebreak defaults to false (F8 opt-in)", () => {
  const parsed = ModelRegistryConfigSchema.parse({});

  assertEquals(parsed!.task_type_map, {});
  assertEquals(parsed!.usage_tiebreak, false);
});

Deno.test("[step135.8] task_type_map and benchmark_map reject non-canonical TaskType keys (Zod, G7)", () => {
  assertThrows(() =>
    ModelRegistryConfigSchema.parse({
      benchmark_map: { not_a_real_task_type: ["swe_bench_verified"] },
    })
  );
  assertThrows(() =>
    ModelRegistryConfigSchema.parse({
      task_type_map: { "senior-coder": "not_a_real_task_type" },
    })
  );
});

Deno.test("[step135.8] task_type_map accepts a canonical TaskType soft-match entry", () => {
  const parsed = ModelRegistryConfigSchema.parse({
    task_type_map: { "senior-coder-v2": "feature" },
  });

  assertEquals(parsed!.task_type_map, { "senior-coder-v2": TaskType.FEATURE });
});

Deno.test("[step135.8] usage_tiebreak accepts an explicit true override", () => {
  const parsed = ModelRegistryConfigSchema.parse({ usage_tiebreak: true });

  assertEquals(parsed!.usage_tiebreak, true);
});
