/**
 * @module RoutingCompat
 * @path src/services/routing/mod.ts
 * @description Compatibility re-exports from @exaix/routing package.
 * @deprecated Import directly from "@exaix/routing" instead.
 * @architectural-layer Services
 * @related-files ["packages/routing"]
 */

export {
  CandidateDiscovery,
  CapabilityMatcher,
  IdentityPerformanceRepository,
  RoutingPolicyLoader,
  RoutingPolicyService,
} from "@exaix/routing";

export type {
  ICandidateDiscovery,
  ICandidateDiscoveryOptions,
  ICapabilityMatcherOptions,
  IIdentityPerformanceProvider,
  IIdentityPerformanceRepository,
  IIdentityPerformanceRepositoryOptions,
  IIdentityPerformanceSnapshot,
  IRoutingPolicyLoader,
  IRoutingPolicyLoaderOptions,
  IRoutingPolicyLoadResult,
  IRoutingPolicyService,
  IRoutingPolicyServiceOptions,
} from "@exaix/routing";
