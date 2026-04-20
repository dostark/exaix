/**
 * @module RoutingAdapter
 * @path src/services/adapters/routing_adapter.ts
 * @description Adapter for routing policy services to satisfy CLI boundary requirements.
 * @architectural-layer Services/Adapters
 * * @related-files [src/services/routing/routing_policy_service.ts, src/cli/commands/routing_commands.ts]
 */

import type { Config } from "../../shared/schemas/config.ts";
import type { IDatabaseService } from "../core/db.ts";
import { BlueprintLoader } from "../blueprint/blueprint_loader.ts";
import { CandidateDiscovery } from "../routing/candidate_discovery.ts";
import { IdentityPerformanceRepository } from "../routing/identity_performance_repository.ts";
import { RoutingPolicyLoader } from "../routing/routing_policy_loader.ts";
import { RoutingPolicyService } from "../routing/routing_policy_service.ts";

export interface ICreateRoutingPolicyServiceOptions {
  config: Config;
  root: string;
  db: IDatabaseService;
  experimentSalt: string;
}

export function createRoutingPolicyService(
  options: ICreateRoutingPolicyServiceOptions,
): RoutingPolicyService {
  const blueprintLoader = new BlueprintLoader({
    blueprintsPath: `${options.root}/${options.config.paths.blueprints}`,
  });

  return new RoutingPolicyService({
    policyLoader: new RoutingPolicyLoader({
      config: options.config,
      root: options.root,
    }),
    candidateDiscovery: new CandidateDiscovery(blueprintLoader),
    performanceRepository: new IdentityPerformanceRepository({
      db: options.db,
    }),
    experimentSalt: options.experimentSalt,
  });
}
