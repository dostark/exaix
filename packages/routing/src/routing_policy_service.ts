/**
 * @module RoutingPolicyService
 * @path packages/routing/src/routing_policy_service.ts
 * @description Selects the best identity and version using routing rules,
 * capability candidates, journal performance, and deterministic experiments.
 * @architectural-layer Services
 * @related-files [packages/routing/src/routing_policy_loader.ts, packages/routing/src/candidate_discovery.ts, packages/routing/src/identity_performance_repository.ts]
 */

import {
  type IRoutingCandidate,
  type IRoutingContext,
  type IRoutingMatchCriteria,
  type IRoutingPolicy,
  type IRoutingPolicyDecision,
  type IRoutingPreference,
  type IRoutingRule,
  ZRoutingCandidate,
  ZRoutingPolicyDecision,
} from "@exaix/schemas/routing_policy.ts";
import type { IIdentityPerformanceSnapshot } from "./identity_performance_repository.ts";
import type { IRoutingPolicyLoadResult } from "./routing_policy_loader.ts";

export interface IRoutingPolicyLoader {
  loadPolicy(): Promise<IRoutingPolicyLoadResult>;
}

export interface ICandidateDiscovery {
  listCandidates(criteria: IRoutingMatchCriteria, explicitIdentityId?: string): Promise<IRoutingCandidate[]>;
}

export interface IIdentityPerformanceProvider {
  getPerformanceByCapability(capability: string, portalName?: string): Promise<IIdentityPerformanceSnapshot[]>;
}

export interface IRoutingPolicyServiceOptions {
  policyLoader: IRoutingPolicyLoader;
  candidateDiscovery: ICandidateDiscovery;
  performanceRepository: IIdentityPerformanceProvider;
  experimentSalt?: string;
}

export interface IRoutingPolicyService {
  selectIdentity(context: IRoutingContext): Promise<IRoutingPolicyDecision>;
}

export class RoutingPolicyService {
  private readonly experimentSalt: string;

  constructor(private readonly options: IRoutingPolicyServiceOptions) {
    this.experimentSalt = options.experimentSalt?.trim() ?? "";
  }

  async selectIdentity(context: IRoutingContext): Promise<IRoutingPolicyDecision> {
    const policyResult = await this.options.policyLoader.loadPolicy();
    const policy = policyResult.success
      ? policyResult.policy
      : { version: "1.0", rules: [], defaultMode: "policy_first", allowExperiments: false } as IRoutingPolicy;
    const criteria = this.buildMatchCriteria(context);
    const candidates = await this.options.candidateDiscovery.listCandidates(criteria, context.explicitIdentityId);

    const explicitDecision = this.tryExplicitSelection(context, candidates);
    if (explicitDecision) {
      return explicitDecision;
    }

    const ruleDecision = await this.tryPolicyDecision(policy, context, criteria, candidates);
    if (ruleDecision) {
      return ruleDecision;
    }

    return await this.buildFallbackDecision(policy, criteria, candidates, context.portalName);
  }

  private buildMatchCriteria(context: IRoutingContext): IRoutingMatchCriteria {
    const analysis = context.requestAnalysis;
    const explicitCriteria = context.matchCriteria;
    const capability = explicitCriteria?.capability?.trim() || undefined;
    return {
      capability,
      complexityMin: explicitCriteria?.complexityMin,
      complexityMax: explicitCriteria?.complexityMax,
      language: explicitCriteria?.language,
      taskType: explicitCriteria?.taskType ?? analysis?.taskType,
      portalType: explicitCriteria?.portalType,
      tags: explicitCriteria?.tags ?? analysis?.tags ?? [],
    };
  }

  private tryExplicitSelection(
    context: IRoutingContext,
    candidates: IRoutingCandidate[],
  ): IRoutingPolicyDecision | null {
    if (!context.explicitIdentityId) {
      return null;
    }

    const explicitCandidates = candidates.filter((candidate) => candidate.identityId === context.explicitIdentityId);
    if (explicitCandidates.length === 0) {
      return null;
    }

    const selected = context.explicitVersion
      ? explicitCandidates.find((candidate) => candidate.version === context.explicitVersion) ?? explicitCandidates[0]
      : explicitCandidates[0];

    const scoredCandidates = explicitCandidates.concat(
      candidates.filter((candidate) => candidate.identityId !== context.explicitIdentityId),
    );
    const decision = ZRoutingPolicyDecision.parse({
      selectedIdentityId: selected.identityId,
      selectedVersion: selected.version,
      strategy: "explicit",
      candidates: scoredCandidates,
      rationale: `Explicit identity requested: ${selected.identityId}@${selected.version}`,
      decidedAt: new Date().toISOString(),
    });

    return decision;
  }

  private async tryPolicyDecision(
    policy: IRoutingPolicy,
    context: IRoutingContext,
    criteria: IRoutingMatchCriteria,
    candidates: IRoutingCandidate[],
  ): Promise<IRoutingPolicyDecision | null> {
    const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);
    for (const rule of sortedRules) {
      if (!this.ruleMatches(rule.match, criteria)) {
        continue;
      }

      const preferredCandidate = this.findPreferredCandidate(rule.prefer, candidates);
      if (!preferredCandidate) {
        continue;
      }

      const { chosenCandidate, experimentApplied, experimentBucket } = await this.applyExperiment(
        rule,
        preferredCandidate,
        candidates,
        context,
        policy,
      );
      const scoredCandidates = await this.scoreCandidates(
        candidates,
        rule.ruleId,
        chosenCandidate,
        experimentApplied ? 1 : 0,
        criteria,
        context.portalName,
      );

      return ZRoutingPolicyDecision.parse({
        selectedIdentityId: chosenCandidate.identityId,
        selectedVersion: chosenCandidate.version,
        strategy: "policy",
        experimentApplied,
        experimentBucket,
        matchedRuleId: rule.ruleId,
        candidates: scoredCandidates,
        rationale: experimentApplied
          ? `Rule ${rule.ruleId} matched and experiment applied to select ${chosenCandidate.identityId}@${chosenCandidate.version}`
          : `Rule ${rule.ruleId} matched and selected preferred candidate ${chosenCandidate.identityId}@${chosenCandidate.version}`,
        decidedAt: new Date().toISOString(),
      });
    }

    return null;
  }

  private ruleMatches(match: IRoutingMatchCriteria, criteria: IRoutingMatchCriteria): boolean {
    return this.matchesField(match.capability, criteria.capability) &&
      this.matchesField(match.taskType, criteria.taskType) &&
      this.matchesField(match.language, criteria.language) &&
      this.matchesField(match.portalType, criteria.portalType) &&
      this.matchesComplexityBounds(match, criteria) &&
      this.matchesTags(match.tags, criteria.tags);
  }

  private matchesField(value?: string, candidate?: string): boolean {
    if (!value) return true;
    return value.trim().toLowerCase() === (candidate ?? "").trim().toLowerCase();
  }

  private matchesComplexityBounds(
    match: IRoutingMatchCriteria,
    criteria: IRoutingMatchCriteria,
  ): boolean {
    if (
      match.complexityMin !== undefined && criteria.complexityMin !== undefined &&
      criteria.complexityMin < match.complexityMin
    ) {
      return false;
    }

    if (
      match.complexityMax !== undefined && criteria.complexityMax !== undefined &&
      criteria.complexityMax > match.complexityMax
    ) {
      return false;
    }

    return true;
  }

  private matchesTags(matchTags?: string[], criteriaTags?: string[]): boolean {
    if (!matchTags || matchTags.length === 0) return true;
    const normalizedCriteriaTags = (criteriaTags ?? []).map((tag) => tag.trim().toLowerCase());
    return matchTags.every((tag) => normalizedCriteriaTags.includes(tag.trim().toLowerCase()));
  }

  private findPreferredCandidate(
    prefer: IRoutingPreference,
    candidates: IRoutingCandidate[],
  ): IRoutingCandidate | null {
    let match = candidates.filter((candidate) => candidate.identityId === prefer.identityId);
    if (prefer.version) {
      match = match.filter((candidate) => candidate.version === prefer.version);
    }
    if (match.length > 0) {
      return match[0];
    }

    if (prefer.fallbackIdentityId) {
      let fallbackMatch = candidates.filter((candidate) => candidate.identityId === prefer.fallbackIdentityId);
      if (prefer.fallbackVersion) {
        fallbackMatch = fallbackMatch.filter((candidate) => candidate.version === prefer.fallbackVersion);
      }
      return fallbackMatch[0] ?? null;
    }

    return null;
  }

  private async applyExperiment(
    rule: IRoutingRule,
    preferredCandidate: IRoutingCandidate,
    candidates: IRoutingCandidate[],
    context: IRoutingContext,
    policy: IRoutingPolicy,
  ): Promise<{ chosenCandidate: IRoutingCandidate; experimentApplied: boolean; experimentBucket?: number }> {
    if (
      rule.prefer.trafficSplit === undefined || !policy.allowExperiments || !this.experimentSalt || !context.traceId
    ) {
      return { chosenCandidate: preferredCandidate, experimentApplied: false };
    }

    const bucket = await this.computeExperimentBucket(context.traceId, this.experimentSalt);
    if (bucket < rule.prefer.trafficSplit) {
      return { chosenCandidate: preferredCandidate, experimentApplied: true, experimentBucket: bucket };
    }

    if (rule.prefer.fallbackIdentityId) {
      const fallback = this.findPreferredCandidate({
        identityId: rule.prefer.fallbackIdentityId,
        version: rule.prefer.fallbackVersion,
      } as IRoutingPreference, candidates);
      if (fallback) {
        return { chosenCandidate: fallback, experimentApplied: true, experimentBucket: bucket };
      }
    }

    return { chosenCandidate: preferredCandidate, experimentApplied: false, experimentBucket: bucket };
  }

  private async scoreCandidates(
    candidates: IRoutingCandidate[],
    matchedRuleId: string | null,
    winner: IRoutingCandidate,
    experimentScore: number,
    criteria: IRoutingMatchCriteria,
    portalName?: string,
  ): Promise<IRoutingCandidate[]> {
    const journalSnapshots = criteria.capability
      ? await this.options.performanceRepository.getPerformanceByCapability(criteria.capability, portalName)
      : [];

    return candidates.map((candidate) => {
      const snapshot = journalSnapshots.find((snapshot) =>
        snapshot.identityId === candidate.identityId && snapshot.version === candidate.version
      );
      const journalScore = snapshot?.stable ? (snapshot.successRate * 0.5 + snapshot.averageConfidence / 100 * 0.5) : 0;
      const policyScore =
        candidate.identityId === winner.identityId && candidate.version === winner.version && matchedRuleId ? 1 : 0;
      const totalScore = candidate.score + policyScore + journalScore +
        (candidate.identityId === winner.identityId && candidate.version === winner.version ? experimentScore : 0);

      return ZRoutingCandidate.parse({
        ...candidate,
        score: totalScore,
        scoreBreakdown: {
          capabilityScore: candidate.score,
          policyScore,
          journalScore,
          experimentScore: candidate.identityId === winner.identityId && candidate.version === winner.version
            ? experimentScore
            : 0,
        },
      });
    }).sort((a, b) => b.score - a.score || a.identityId.localeCompare(b.identityId));
  }

  private async buildFallbackDecision(
    policy: IRoutingPolicy,
    criteria: IRoutingMatchCriteria,
    candidates: IRoutingCandidate[],
    portalName?: string,
  ): Promise<IRoutingPolicyDecision> {
    const scoredCandidates = await this.scoreCandidates(
      candidates,
      null,
      candidates[0] ??
        {
          identityId: "unknown",
          version: "unknown",
          capabilities: [],
          score: 0,
          scoreBreakdown: { capabilityScore: 0, policyScore: 0, journalScore: 0, experimentScore: 0 },
        },
      0,
      criteria,
      portalName,
    );
    const selected = scoredCandidates[0];

    return ZRoutingPolicyDecision.parse({
      selectedIdentityId: selected.identityId,
      selectedVersion: selected.version,
      strategy: policy.defaultMode === "static" ? "static_fallback" : "capability_fallback",
      candidates: scoredCandidates,
      rationale: selected.identityId === "unknown"
        ? "No candidate blueprints were available for routing."
        : `No routing rule matched; selected best candidate ${selected.identityId}@${selected.version} using ${policy.defaultMode} fallback.`,
      decidedAt: new Date().toISOString(),
    });
  }

  private async computeExperimentBucket(traceId: string, salt: string): Promise<number> {
    const data = new TextEncoder().encode(traceId + salt);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const view = new DataView(digest);
    const normalized = view.getUint32(0, false) / 0xffffffff;
    return normalized;
  }
}
