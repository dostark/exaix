/**
 * @module RoutingAdapter
 * @path apps/common/adapters/routing_adapter.ts
 * @description Adapter for routing policy services to satisfy CLI boundary requirements.
 * @architectural-layer Services/Adapters
 * @related-files ["packages/routing/src/routing_policy_service.ts", "apps/exactl/src/commands/routing_commands.ts"]
 */

import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { IRoutingPolicyLoadResult } from "@exaix/routing";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { CandidateDiscovery } from "@exaix/routing";
import { AgentRolePerformanceRepository } from "@exaix/routing";
import { RoutingPolicyLoader } from "@exaix/routing";
import { RoutingPolicyService } from "@exaix/routing";

export interface ICreateRoutingPolicyServiceOptions {
  config: Config;
  root: string;
  db: IDatabaseService;
  experimentSalt: string;
}

export function createRoutingPolicyService(
  options: ICreateRoutingPolicyServiceOptions,
): RoutingPolicyService {
  const blueprintLoader = new IBlueprintLoader({
    blueprintsPath: `${options.root}/${options.config.paths.blueprints}`,
  });

  const policyLoader = new RoutingPolicyLoader({
    config: options.config,
    root: options.root,
  });

  policyLoader.startWatching();

  return new RoutingPolicyService({
    policyLoader,
    candidateDiscovery: new CandidateDiscovery(blueprintLoader),
    performanceRepository: new AgentRolePerformanceRepository({
      db: options.db,
    }),
    experimentSalt: options.experimentSalt,
  });
}

export async function loadRoutingPolicy(
  options: { config: Config; root: string },
): Promise<IRoutingPolicyLoadResult> {
  return await new RoutingPolicyLoader({
    config: options.config,
    root: options.root,
  }).loadPolicy();
}
