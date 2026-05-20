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
        prefer: { enabled: true, identityId: "beta", version: "2.0.0" },
      },
    ],
  };

  const candidates = [
    createRoutingCandidate({
      identityId: "alpha",
      version: "1.0.0",
      capabilities: ["code_review"],
      score: 0.8,
    }),
    createRoutingCandidate({
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.6,
    }),
  ];

  const service = createRoutingPolicyService(policy, candidates);

  const decision = await service.selectIdentity({
    matchCriteria: { capability: "code_review", tags: [] },
    traceId: "trace-rule-match",
  });

  assertEquals(decision.strategy, "policy");
  assertEquals(decision.matchedRuleId, "code_review_prefer_beta");
  assertEquals(decision.selectedIdentityId, "beta");
  assertEquals(decision.selectedVersion, "2.0.0");
});
