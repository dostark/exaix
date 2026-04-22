/**
 * @module RoutingPolicyServiceFallbackTest
 * @path tests/services/routing/routing_policy_service_fallback_test.ts
 * @description Verifies fallback behavior when no routing rules match.
 */

import { assertEquals } from "@std/assert";
import { RoutingPolicyService } from "../../../src/services/routing/routing_policy_service.ts";
import type { IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";

Deno.test("RoutingPolicyService: returns explicit identity when requested even if no rule matches", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
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
      capabilities: ["documentation"],
      score: 0.7,
      scoreBreakdown: { capabilityScore: 0.7, policyScore: 0, journalScore: 0, experimentScore: 0 },
    },
    {
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.9,
      scoreBreakdown: { capabilityScore: 0.9, policyScore: 0, journalScore: 0, experimentScore: 0 },
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
    explicitIdentityId: "beta",
    matchCriteria: { capability: "code_review", tags: [] },
  });

  assertEquals(decision.strategy, "explicit");
  assertEquals(decision.selectedIdentityId, "beta");
  assertEquals(decision.selectedVersion, "2.0.0");
});

Deno.test("RoutingPolicyService: falls back to best capability candidate when no rule matches", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
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
      score: 0.55,
      scoreBreakdown: { capabilityScore: 0.55, policyScore: 0, journalScore: 0, experimentScore: 0 },
    },
    {
      identityId: "beta",
      version: "2.0.0",
      capabilities: ["code_review"],
      score: 0.45,
      scoreBreakdown: { capabilityScore: 0.45, policyScore: 0, journalScore: 0, experimentScore: 0 },
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

  const decision = await service.selectIdentity({ matchCriteria: { capability: "code_review", tags: [] } });

  assertEquals(decision.strategy, "capability_fallback");
  assertEquals(decision.selectedIdentityId, "alpha");
  assertEquals(decision.selectedVersion, "1.0.0");
});
