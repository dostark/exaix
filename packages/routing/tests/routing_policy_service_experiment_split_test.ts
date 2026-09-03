/** @module RoutingPolicyServiceExperimentSplitTest
 * @path packages/routing/tests/routing_policy_service_experiment_split_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import { assertEquals } from "@std/assert";
import type { IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import { createRoutingCandidate, createRoutingPolicyService } from "./routing_policy_test_helper.ts";

async function computeBucket(traceId: string, salt: string): Promise<number> {
  const data = new TextEncoder().encode(traceId + salt);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const view = new DataView(digest);
  return view.getUint32(0, false) / 0xffffffff;
}

Deno.test("RoutingPolicyService: uses deterministic experiment buckets for split routing", async () => {
  const policy: IRoutingPolicy = {
    version: "1.0",
    allowExperiments: true,
    defaultMode: "policy_first",
    rules: [
      {
        ruleId: "experimental-alpha",
        priority: 10,
        match: { tags: [], capability: "code_review" },
        prefer: {
          enabled: true,
          agentRole: "beta",
          version: "2.0.0",
          fallbackAgentRole: "alpha",
          fallbackVersion: "1.0.0",
          trafficSplit: 0.5,
        },
      },
    ],
  };
  const candidates = [
    createRoutingCandidate({
      agentRole: "alpha",
      version: "1.0.0",
      capabilities: ["code_review"],
      score: 0.5,
    }),
    createRoutingCandidate({
      agentRole: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.5,
    }),
  ];
  const service = createRoutingPolicyService(policy, candidates);

  const traceId = "trace-experiment-split-1";
  const bucket = await computeBucket(traceId, "test-salt");
  const decision = await service.selectAgentRole({ matchCriteria: { capability: "code_review", tags: [] }, traceId });

  if (bucket < 0.5) {
    assertEquals(decision.selectedAgentRole, "beta");
    assertEquals(decision.selectedVersion, "2.0.0");
  } else {
    assertEquals(decision.selectedAgentRole, "alpha");
    assertEquals(decision.selectedVersion, "1.0.0");
  }

  assertEquals(decision.experimentApplied, true);
  assertEquals(typeof decision.experimentBucket, "number");
  assertEquals(decision.experimentBucket, bucket);

  const decisionRepeat = await service.selectAgentRole({
    matchCriteria: { capability: "code_review", tags: [] },
    traceId,
  });

  assertEquals(decision.selectedAgentRole, decisionRepeat.selectedAgentRole);
  assertEquals(decision.selectedVersion, decisionRepeat.selectedVersion);
  assertEquals(decision.strategy, decisionRepeat.strategy);
  assertEquals(decision.matchedRuleId, decisionRepeat.matchedRuleId);
  assertEquals(decision.experimentApplied, decisionRepeat.experimentApplied);
  assertEquals(decision.experimentBucket, decisionRepeat.experimentBucket);
});
