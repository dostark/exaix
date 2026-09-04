/**
 * @module ScenarioFrameworkIdentityConfigPruneVerdictTest
 * @path tests/scenario_framework/tests/unit/identity_config_prune_verdict_test.ts
 * @description Tests for Phase 158 Step 5's identity-config prune verdict: settles
 * whether Phase 142 Step 17's default_skills prune helped, hurt, or did nothing, by
 * reading Step 1's already-computed paired comparison rather than re-deriving a verdict
 * rule. Convention: treatment is the post-prune config, control is the pre-prune config,
 * so a positive delta means the prune helped.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/identity_config_prune_verdict.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals } from "@std/assert";
import { interpretPruneVerdict } from "../../runner/identity_config_prune_verdict.ts";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

Deno.test("[IdentityConfigPruneVerdict] a positive delta (post-prune scores higher) verdicts helped", () => {
  const result = computePairedComparison({
    armId: "identity-config-prune",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "task-1", control: [0.5, 0.5, 0.5], treatment: [0.9, 0.9, 0.9] }],
  });
  assertEquals(interpretPruneVerdict(result), "helped");
});

Deno.test("[IdentityConfigPruneVerdict] a negative delta (post-prune scores lower) verdicts hurt", () => {
  const result = computePairedComparison({
    armId: "identity-config-prune",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "task-1", control: [0.9, 0.9, 0.9], treatment: [0.5, 0.5, 0.5] }],
  });
  assertEquals(interpretPruneVerdict(result), "hurt");
});

Deno.test("[IdentityConfigPruneVerdict] a delta indistinguishable from noise verdicts no-effect, not helped or hurt", () => {
  const result = computePairedComparison({
    armId: "identity-config-prune",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.48] },
      { taskId: "task-2", control: [0.5], treatment: [0.9] },
    ],
  });
  assertEquals(interpretPruneVerdict(result), "no-effect");
});
