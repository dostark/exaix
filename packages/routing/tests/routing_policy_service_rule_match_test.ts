/** @module RoutingPolicyServiceRuleMatchTest
 * @path packages/routing/tests/routing_policy_service_rule_match_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import { assertEquals } from "@std/assert";
import type { IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import { createRoutingCandidate, createRoutingPolicyService } from "./routing_policy_test_helper.ts";

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
        prefer: { enabled: true, agentRole: "beta", version: "2.0.0" },
      },
    ],
  };

  const candidates = [
    createRoutingCandidate({
      agentRole: "alpha",
      version: "1.0.0",
      capabilities: ["code_review"],
      score: 0.8,
    }),
    createRoutingCandidate({
      agentRole: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.6,
    }),
  ];

  const service = createRoutingPolicyService(policy, candidates);

  const decision = await service.selectAgentRole({
    matchCriteria: { capability: "code_review", tags: [] },
    traceId: "trace-rule-match",
  });

  assertEquals(decision.strategy, "policy");
  assertEquals(decision.matchedRuleId, "code_review_prefer_beta");
  assertEquals(decision.selectedAgentRole, "beta");
  assertEquals(decision.selectedVersion, "2.0.0");
});
