/**
 * @module ScenarioFrameworkAgentRoleConfigPruneVerdict
 * @path tests/scenario_framework/runner/agent_role_config_prune_verdict.ts
 * @description Phase 158 Step 5's agent-role-config prune verdict: settles whether Phase
 * 142 Step 17's default_skills prune helped, hurt, or did nothing, by reading Step 1's
 * already-computed paired comparison rather than re-deriving a verdict rule. Convention:
 * treatment is the post-prune config, control is the pre-prune config, so a positive
 * delta means the prune helped. Pure computation only — running the agent-role-config arm
 * itself is the caller's concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/agent_role_config_prune_verdict_test.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import type { IPairedComparisonResult } from "./arm_comparison.ts";

export type PruneVerdict = "helped" | "hurt" | "no-effect";

export function interpretPruneVerdict(result: IPairedComparisonResult): PruneVerdict {
  if (result.noEffect) return "no-effect";
  return result.meanDelta > 0 ? "helped" : "hurt";
}
