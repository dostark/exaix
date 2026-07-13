/**
 * @module Routing
 * @path packages/routing/mod.ts
 * @architectural-layer Services
 * @description Routing policy: capability matching, experiment splitting, performance-based identity selection.
 * @related-files ["packages/schemas/src/routing_policy.ts", "packages/routing/src/"]
 */

export { CandidateDiscovery } from "./src/candidate_discovery.ts";
export { CapabilityMatcher } from "./src/capability_matcher.ts";
export { IdentityPerformanceRepository } from "./src/identity_performance_repository.ts";
export { RoutingPolicyLoader } from "./src/routing_policy_loader.ts";
export { RoutingPolicyService } from "./src/routing_policy_service.ts";
export type { ICandidateDiscoveryOptions } from "./src/candidate_discovery.ts";
export type { ICapabilityMatcherOptions } from "./src/capability_matcher.ts";
export type { IRoutingPolicyLoaderOptions, IRoutingPolicyLoadResult } from "./src/routing_policy_loader.ts";
export type {
  IBuildSnapshotOptions,
  IIdentityPerformanceRepository,
  IIdentityPerformanceRepositoryOptions,
  IIdentityPerformanceSnapshot,
} from "./src/identity_performance_repository.ts";
export type {
  ICandidateDiscovery,
  IIdentityPerformanceProvider,
  IRoutingPolicyLoader,
  IRoutingPolicyService,
  IRoutingPolicyServiceOptions,
} from "./src/routing_policy_service.ts";
