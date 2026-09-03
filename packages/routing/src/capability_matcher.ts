/**
 * @module CapabilityMatcher
 * @path packages/routing/src/capability_matcher.ts
 * @description Matches blueprints to routing criteria and assigns capability scores.
 * @architectural-layer Services
 * @related-files ["packages/schemas/src/routing_policy.ts", packages/routing/src/candidate_discovery.ts]
 */

import { ZRoutingCandidate } from "@exaix/schemas/routing_policy.ts";
import type { ILoadedBlueprint } from "./internal_types.ts";
import type { IRoutingMatchCriteria } from "@exaix/schemas/routing_policy.ts";
import type { JSONValue } from "@exaix/core";

type BlueprintFrontmatterMap = {
  [key: string]: JSONValue;
};

export interface ICapabilityMatcherOptions {
  allowDeprecated?: boolean;
}

function normalize(values: Array<string | undefined> = []): string[] {
  return values
    .filter((value): value is string => typeof value === "string")
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
    const metadata = this.extractBlueprintMetadata(blueprint);

    if (requestedCapability && !blueprintCapabilities.includes(requestedCapability)) {
      return null;
    }

    const capabilityScore = this.computeCapabilityScore(
      requestedCapability,
      requestedTags,
      blueprintCapabilities,
    );
    const score = this.computeOverallScore(capabilityScore, criteria, metadata);

    return ZRoutingCandidate.parse({
      agentRole: blueprint.agentRole,
      version: blueprint.version,
      capabilities: blueprintCapabilities,
      score,
      scoreBreakdown: {
        capabilityScore: score,
        policyScore: 0,
        journalScore: 0,
        experimentScore: 0,
      },
    });
  }

  private extractBlueprintMetadata(blueprint: ILoadedBlueprint): {
    language: string;
    taskType: string;
    portalType: string;
    description: string;
    routingHint: string;
  } {
    const frontmatter = blueprint.frontmatter as BlueprintFrontmatterMap;
    const languageField = typeof frontmatter.language === "string"
      ? frontmatter.language
      : typeof frontmatter.lang === "string"
      ? frontmatter.lang
      : undefined;
    const taskTypeField = typeof frontmatter.task_type === "string"
      ? frontmatter.task_type
      : typeof frontmatter.taskType === "string"
      ? frontmatter.taskType
      : undefined;
    const portalTypeField = typeof frontmatter.portal_type === "string"
      ? frontmatter.portal_type
      : typeof frontmatter.portalType === "string"
      ? frontmatter.portalType
      : undefined;

    const descriptionField = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
    const routingHintField = typeof frontmatter.routing_hint === "string" ? frontmatter.routing_hint : undefined;

    return {
      language: normalize([languageField])[0] ?? "",
      taskType: normalize([taskTypeField])[0] ?? "",
      portalType: normalize([portalTypeField])[0] ?? "",
      description: descriptionField?.toLowerCase() ?? "",
      routingHint: routingHintField?.toLowerCase() ?? "",
    };
  }

  /** Scores word overlap between request text and blueprint description/routing_hint. */
  private computeTextScore(
    requestText: string,
    description: string,
    routingHint: string,
  ): number {
    const textTokens = new Set(
      requestText.toLowerCase().split(/[\W_]+/).filter((t) => t.length > 2),
    );
    const hintTokens = new Set(
      (routingHint + " " + description).toLowerCase().split(/[\W_]+/).filter((t) => t.length > 2),
    );

    if (textTokens.size === 0 || hintTokens.size === 0) return 0;

    let overlapCount = 0;
    for (const token of textTokens) {
      if (hintTokens.has(token)) overlapCount++;
    }

    return overlapCount / textTokens.size;
  }

  /** Selects closest blueprint by capability overlap and text score when no exact match exists. */
  fallback(
    blueprints: ILoadedBlueprint[],
    criteria: IRoutingMatchCriteria,
  ): ReturnType<typeof ZRoutingCandidate.parse> | null {
    let best: ReturnType<typeof ZRoutingCandidate.parse> | null = null;
    let bestScore = -1;

    for (const bp of blueprints) {
      if (bp.frontmatter.deprecated && !this.allowDeprecated) continue;

      const blueprintCapabilities = normalize(bp.capabilities);
      const requestedCapability = criteria.capability ? criteria.capability.trim().toLowerCase() : "";
      const requestedTags = normalize(criteria.tags ?? []);

      const hasCapability = !requestedCapability || blueprintCapabilities.includes(requestedCapability);
      const matchedTags = requestedTags.filter((tag) => blueprintCapabilities.includes(tag));
      const totalRequested = requestedCapability ? 1 + requestedTags.length : requestedTags.length;
      const matched = [
        ...(requestedCapability && hasCapability ? [requestedCapability] : []),
        ...matchedTags,
      ];
      const uniqueMatches = Array.from(new Set(matched));
      const capabilityScore = totalRequested > 0 ? uniqueMatches.length / totalRequested : 1;

      const metadata = this.extractBlueprintMetadata(bp);
      let overallScore = this.computeOverallScore(capabilityScore, criteria, metadata);

      // Boost score when requestText matches description or routing_hint
      if (criteria.requestText && overallScore > 0) {
        const textScore = this.computeTextScore(criteria.requestText, metadata.description, metadata.routingHint);
        overallScore = overallScore * 0.8 + textScore * 0.2;
      }

      if (capabilityScore <= 0) continue;

      if (overallScore > bestScore) {
        bestScore = overallScore;
        best = ZRoutingCandidate.parse({
          agentRole: bp.agentRole,
          version: bp.version,
          capabilities: blueprintCapabilities,
          score: overallScore,
          scoreBreakdown: {
            capabilityScore,
            policyScore: 0,
            journalScore: 0,
            experimentScore: 0,
          },
        });
      }
    }

    return best;
  }

  private computeCapabilityScore(
    requestedCapability: string,
    requestedTags: string[],
    blueprintCapabilities: string[],
  ): number {
    const matchedTags = requestedTags.filter((tag) => blueprintCapabilities.includes(tag));
    const totalRequested = requestedCapability ? 1 + requestedTags.length : requestedTags.length;
    const matched = [
      ...(requestedCapability ? [requestedCapability] : []),
      ...matchedTags,
    ];
    const uniqueMatches = Array.from(new Set(matched));
    return totalRequested > 0 ? uniqueMatches.length / totalRequested : 1;
  }

  private computeOverallScore(
    capabilityScore: number,
    criteria: IRoutingMatchCriteria,
    metadata: { language: string; taskType: string; portalType: string },
  ): number {
    if (!criteria.language && !criteria.taskType && !criteria.portalType) {
      return capabilityScore;
    }

    const languageScore = criteria.language
      ? (metadata.language === criteria.language.trim().toLowerCase() ? 1 : 0)
      : 1;
    const taskTypeScore = criteria.taskType
      ? (metadata.taskType === criteria.taskType.trim().toLowerCase() ? 1 : 0)
      : 1;
    const portalTypeScore = criteria.portalType
      ? (metadata.portalType === criteria.portalType.trim().toLowerCase() ? 1 : 0)
      : 1;

    const metadataScore = (languageScore + taskTypeScore + portalTypeScore) / 3;
    return capabilityScore * 0.75 + metadataScore * 0.25;
  }
}
