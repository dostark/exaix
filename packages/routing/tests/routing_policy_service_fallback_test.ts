/** @module RoutingPolicyServiceFallbackTest */
import { assertEquals } from "@std/assert";
import type { IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import { createRoutingCandidate, createRoutingPolicyService } from "./routing_policy_test_helper.ts";

Deno.test("RoutingPolicyService: returns explicit identity when requested even if no rule matches", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
  const candidates = [
    createRoutingCandidate({
      identityId: "alpha",
      version: "1.0.0",
      capabilities: ["documentation"],
      score: 0.7,
    }),
    createRoutingCandidate({
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.9,
    }),
  ];
  const service = createRoutingPolicyService(policy, candidates);

  const decision = await service.selectIdentity({
    explicitIdentityId: "beta",
    matchCriteria: { capability: "code_review", tags: [] },
  });

  assertEquals(decision.strategy, "explicit");
  assertEquals(decision.selectedIdentityId, "beta");
  assertEquals(decision.selectedVersion, "2.0.0");
});

Deno.test("RoutingPolicyService: falls back to best capability candidate when no rule matches", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
  const candidates = [
    createRoutingCandidate({
      identityId: "alpha",
      version: "1.0.0",
      capabilities: ["code_review"],
      score: 0.55,
    }),
    createRoutingCandidate({
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.45,
    }),
  ];
  const service = createRoutingPolicyService(policy, candidates);

  const decision = await service.selectIdentity({ matchCriteria: { capability: "code_review", tags: [] } });

  assertEquals(decision.strategy, "capability_fallback");
  assertEquals(decision.selectedIdentityId, "alpha");
  assertEquals(decision.selectedVersion, "1.0.0");
});
