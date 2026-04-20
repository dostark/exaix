/**
 * @module RoutingPolicyServiceRuleMatchTest
 * @path tests/services/routing/routing_policy_service_rule_match_test.ts
 * @description Verifies that routing policy rules select the preferred identity/version.
 */

import { assertEquals } from "@std/assert";
import { RoutingPolicyService } from "../../../src/services/routing/routing_policy_service.ts";
import type { IRoutingPolicy } from "../../../src/shared/schemas/routing_policy.ts";

Deno.test("RoutingPolicyService: selects preferred candidate when a routing rule matches", async () => {
  const policy: IRoutingPolicy = {
    version: "1.0",
    allowExperiments: false,
    defaultMode: "policy_first",
    rules: [
      {
        ruleId: "code_review_prefer_beta",
        priority: 5,
        match: { tags: [], capability: "code_review" },
        prefer: { enabled: true, identityId: "beta", version: "2.0.0" },
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
      score: 0.8,
      scoreBreakdown: { capabilityScore: 0.8, policyScore: 0, journalScore: 0, experimentScore: 0 },
    },
    {
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.6,
      scoreBreakdown: { capabilityScore: 0.6, policyScore: 0, journalScore: 0, experimentScore: 0 },
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

  const decision = await service.selectIdentity({
    matchCriteria: { capability: "code_review", tags: [] },
    traceId: "trace-rule-match",
  });

  assertEquals(decision.strategy, "policy");
  assertEquals(decision.matchedRuleId, "code_review_prefer_beta");
  assertEquals(decision.selectedIdentityId, "beta");
  assertEquals(decision.selectedVersion, "2.0.0");
});
