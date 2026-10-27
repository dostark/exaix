/**
 * @module Routing
 * @path packages/routing/mod.ts
 * @architectural-layer Services
 * @description Routing policy: capability matching, experiment splitting, performance-based agent-role selection.
 * @related-files ["packages/schemas/src/routing_policy.ts", "packages/routing/src/"]
 */

export { CandidateDiscovery } from "./src/candidate_discovery.ts";
export { CapabilityMatcher } from "./src/capability_matcher.ts";
export { AgentRolePerformanceRepository } from "./src/agent_role_performance_repository.ts";
export { RoutingPolicyLoader } from "./src/routing_policy_loader.ts";
export { RoutingPolicyService } from "./src/routing_policy_service.ts";
export type { IRoutingPolicyLoadResult } from "./src/routing_policy_loader.ts";
export type { IAgentRolePerformanceSnapshot } from "./src/agent_role_performance_repository.ts";
export type { IRoutingPolicyService, IRoutingPolicyServiceOptions } from "./src/routing_policy_service.ts";
