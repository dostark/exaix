/**
 * @module CapabilityMatcher
 * @path src/services/routing/capability_matcher.ts
 * @description Matches blueprints to routing criteria and assigns capability scores.
 * @architectural-layer Services
 * * @related-files [src/shared/schemas/routing_policy.ts, src/services/routing/candidate_discovery.ts]
 */

import { ZRoutingCandidate } from "../../shared/schemas/routing_policy.ts";
import type { ILoadedBlueprint } from "../blueprint/blueprint_loader.ts";
import type { IRoutingMatchCriteria } from "../../shared/schemas/routing_policy.ts";

export interface ICapabilityMatcherOptions {
  allowDeprecated?: boolean;
}

function normalize(values: string[] = []): string[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

export class CapabilityMatcher {
  private readonly allowDeprecated: boolean;

  constructor(options: ICapabilityMatcherOptions = {}) {
    this.allowDeprecated = options.allowDeprecated ?? false;
  }

  matchBlueprint(
    blueprint: ILoadedBlueprint,
    criteria: IRoutingMatchCriteria,
  ): ReturnType<typeof ZRoutingCandidate.parse> | null {
    if (blueprint.frontmatter.deprecated && !this.allowDeprecated) {
      return null;
    }

    const blueprintCapabilities = normalize(blueprint.capabilities);
    const requestedCapability = criteria.capability ? criteria.capability.trim().toLowerCase() : "";
    const requestedTags = normalize(criteria.tags ?? []);

    if (requestedCapability && !blueprintCapabilities.includes(requestedCapability)) {
      return null;
    }

    const matchedTags = requestedTags.filter((tag) => blueprintCapabilities.includes(tag));
    const totalRequested = requestedCapability ? 1 + requestedTags.length : requestedTags.length;
    const matched = [
      ...(requestedCapability ? [requestedCapability] : []),
      ...matchedTags,
    ];
    const uniqueMatches = Array.from(new Set(matched));
    const capabilityScore = totalRequested > 0 ? uniqueMatches.length / totalRequested : 1;

    return ZRoutingCandidate.parse({
      identityId: blueprint.identityId,
      version: blueprint.version,
      capabilities: blueprintCapabilities,
      score: capabilityScore,
      scoreBreakdown: {
        capabilityScore,
        policyScore: 0,
        journalScore: 0,
        experimentScore: 0,
      },
    });
  }
}
