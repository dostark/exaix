/**
 * @module RoutingPolicyServiceExperimentSplitTest
 * @path tests/services/routing/routing_policy_service_experiment_split_test.ts
 * @description Verifies deterministic experiment bucket selection for routing rules.
 */

import { assertEquals } from "@std/assert";
import { RoutingPolicyService } from "../../../src/services/routing/routing_policy_service.ts";
import type { IRoutingPolicy } from "../../../src/shared/schemas/routing_policy.ts";

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
          identityId: "beta",
          version: "2.0.0",
          fallbackIdentityId: "alpha",
          fallbackVersion: "1.0.0",
          trafficSplit: 0.5,
        },
      },
    ],
  };
  const policyLoader = {
    loadPolicy: () =>
      Promise.resolve({
        success: true,
        path: "unused",
        policy,
      }),
  };

  const candidates = [
    {
      identityId: "alpha",
      version: "1.0.0",
      capabilities: ["code_review"],
      score: 0.5,
      scoreBreakdown: { capabilityScore: 0.5, policyScore: 0, journalScore: 0, experimentScore: 0 },
    },
    {
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.5,
      scoreBreakdown: { capabilityScore: 0.5, policyScore: 0, journalScore: 0, experimentScore: 0 },
    },
  ];

  const candidateDiscovery = {
    listCandidates: () => Promise.resolve(candidates),
  };

  const performanceRepository = {
    getPerformanceByCapability: () => Promise.resolve([]),
  };

  const service = new RoutingPolicyService({
    policyLoader,
    candidateDiscovery,
    performanceRepository,
    experimentSalt: "test-salt",
  });

  const traceId = "trace-experiment-split-1";
  const bucket = await computeBucket(traceId, "test-salt");
  const decision = await service.selectIdentity({ matchCriteria: { capability: "code_review", tags: [] }, traceId });

  if (bucket < 0.5) {
    assertEquals(decision.selectedIdentityId, "beta");
    assertEquals(decision.selectedVersion, "2.0.0");
  } else {
    assertEquals(decision.selectedIdentityId, "alpha");
    assertEquals(decision.selectedVersion, "1.0.0");
  }

  const decisionRepeat = await service.selectIdentity({
    matchCriteria: { capability: "code_review", tags: [] },
    traceId,
  });

  assertEquals(decision.selectedIdentityId, decisionRepeat.selectedIdentityId);
  assertEquals(decision.selectedVersion, decisionRepeat.selectedVersion);
  assertEquals(decision.strategy, decisionRepeat.strategy);
  assertEquals(decision.matchedRuleId, decisionRepeat.matchedRuleId);
});
