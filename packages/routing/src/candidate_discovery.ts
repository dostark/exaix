/**
 * @module CandidateDiscovery
 * @path packages/routing/src/candidate_discovery.ts
 * @description Discovers routing candidates from available blueprints and ranks them.
 * @architectural-layer Services
 * @related-files [packages/routing/src/capability_matcher.ts, packages/routing/src/routing_policy_service.ts]
 */

import type { BlueprintLoader } from "./internal_types.ts";
import { CapabilityMatcher } from "./capability_matcher.ts";
import type { IRoutingCandidate, IRoutingMatchCriteria } from "@exaix/schemas/routing_policy.ts";

export interface ICandidateDiscoveryOptions {
  allowDeprecated?: boolean;
}

export class CandidateDiscovery {
  private readonly matcher: CapabilityMatcher;

  constructor(private readonly blueprintLoader: BlueprintLoader, options: ICandidateDiscoveryOptions = {}) {
    this.matcher = new CapabilityMatcher({ allowDeprecated: options.allowDeprecated });
  }

  async listCandidates(
    criteria: IRoutingMatchCriteria,
    explicitIdentityId?: string,
  ): Promise<IRoutingCandidate[]> {
    const blueprints = await this.blueprintLoader.listAll();

    const explicit = explicitIdentityId ? blueprints.filter((bp) => bp.identityId === explicitIdentityId) : [];

    const broad = blueprints.filter((bp) => bp.identityId !== explicitIdentityId);

    let scored = [...explicit, ...broad]
      .map((bp, index) => ({
        candidate: this.matcher.matchBlueprint(bp, criteria),
        isExplicit: index < explicit.length,
      }))
      .filter((entry): entry is { candidate: IRoutingCandidate; isExplicit: boolean } => entry.candidate !== null)
      .sort((a, b) => {
        if (a.isExplicit !== b.isExplicit) {
          return a.isExplicit ? -1 : 1;
        }
        return b.candidate.score - a.candidate.score || a.candidate.identityId.localeCompare(b.candidate.identityId);
      })
      .map((entry) => entry.candidate);

    // Fallback: when no blueprint matches exactly, return the closest match
    if (scored.length === 0 && broad.length > 0) {
      const fallback = this.matcher.fallback(blueprints, criteria);
      if (fallback) {
        scored = [fallback];
      }
    }

    return scored;
  }
}
