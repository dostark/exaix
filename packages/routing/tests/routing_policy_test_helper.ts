/** @module RoutingPolicyTestHelper
 * @path packages/routing/tests/routing_policy_test_helper.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import type { IRoutingCandidate, IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import { type IRoutingPolicyServiceOptions, RoutingPolicyService } from "@exaix/routing";
import type { IIdentityPerformanceSnapshot } from "@exaix/routing";

const TEST_EXPERIMENT_SALT = "test-salt";

interface ICreateRoutingPolicyServiceOptions {
  experimentSalt?: string;
  performanceSnapshots?: IIdentityPerformanceSnapshot[];
}

export function createRoutingCandidate(
  overrides: Omit<IRoutingCandidate, "scoreBreakdown"> & {
    scoreBreakdown?: IRoutingCandidate["scoreBreakdown"];
  },
): IRoutingCandidate {
  return {
    ...overrides,
    scoreBreakdown: overrides.scoreBreakdown ?? {
      capabilityScore: overrides.score,
      policyScore: 0,
      journalScore: 0,
      experimentScore: 0,
    },
  };
}

export function createRoutingPolicyService(
  policy: IRoutingPolicy,
  candidates: IRoutingCandidate[],
  options: ICreateRoutingPolicyServiceOptions = {},
): RoutingPolicyService {
  const serviceOptions: IRoutingPolicyServiceOptions = {
    policyLoader: {
      loadPolicy: () =>
        Promise.resolve({
          success: true,
          path: "unused",
          policy,
        }),
    },
    candidateDiscovery: {
      listCandidates: () => Promise.resolve(candidates),
    },
    performanceRepository: {
      getPerformanceByCapability: () => Promise.resolve(options.performanceSnapshots ?? []),
    },
    experimentSalt: options.experimentSalt ?? TEST_EXPERIMENT_SALT,
  };

  return new RoutingPolicyService(serviceOptions);
}
