/**
 * @module ArmKindPersonaIsolationTest
 * @path tests/scenario_framework/tests/unit/arm_kind_persona_isolation_test.ts
 * @description Verifies the persona-isolation arm kind uses paired comparison machinery.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals } from "@std/assert";
import { ArmKind, ComparisonMetric, computePairedComparison } from "../../runner/arm_comparison.ts";

Deno.test("[PersonaIsolationArmKind] composes with paired comparisons", () => {
  assertEquals(ArmKind.AGENT_ROLE_PERSONA_ISOLATION, "agent-role-persona-isolation");
  const result = computePairedComparison({
    armId: ArmKind.AGENT_ROLE_PERSONA_ISOLATION,
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [{ taskId: "task", control: [0.2, 0.2, 0.2], treatment: [0.5, 0.5, 0.5] }],
  });
  assertEquals(result.noEffect, false);
});
