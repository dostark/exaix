/** @module RoutingPolicyServiceFallbackTest
 * @path packages/routing/tests/routing_policy_service_fallback_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import { assertEquals } from "@std/assert";
import type { IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import { createRoutingCandidate, createRoutingPolicyService } from "./routing_policy_test_helper.ts";

Deno.test("RoutingPolicyService: returns explicit identity when requested even if no rule matches", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
  const candidates = [
    createRoutingCandidate({
      agentRole: "alpha",
      version: "1.0.0",
      capabilities: ["documentation"],
      score: 0.7,
    }),
    createRoutingCandidate({
      agentRole: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.9,
    }),
  ];
  const service = createRoutingPolicyService(policy, candidates);

  const decision = await service.selectAgentRole({
    explicitAgentRole: "beta",
    matchCriteria: { capability: "code_review", tags: [] },
  });

  assertEquals(decision.strategy, "explicit");
  assertEquals(decision.selectedAgentRole, "beta");
  assertEquals(decision.selectedVersion, "2.0.0");
});

Deno.test("RoutingPolicyService: falls back to best capability candidate when no rule matches", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
  const candidates = [
    createRoutingCandidate({
      agentRole: "alpha",
      version: "1.0.0",
      capabilities: ["code_review"],
      score: 0.55,
    }),
    createRoutingCandidate({
      agentRole: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.45,
    }),
  ];
  const service = createRoutingPolicyService(policy, candidates);

  const decision = await service.selectAgentRole({ matchCriteria: { capability: "code_review", tags: [] } });

  assertEquals(decision.strategy, "capability_fallback");
  assertEquals(decision.selectedAgentRole, "alpha");
  assertEquals(decision.selectedVersion, "1.0.0");
});
