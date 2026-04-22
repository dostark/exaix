/**
 * @module KnowledgeInvalidationStrategy
 * @path src/services/portal_knowledge/knowledge_invalidation_strategy.ts
 * @description Git-based invalidation logic for portal knowledge cache.
 * @architectural-layer Services
 * * @related-files [src/services/portal_knowledge/portal_knowledge_service.ts, src/services/portal_knowledge/git_head_resolver.ts]
 */

import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import {
  KnowledgeAnalysisMode as SharedKnowledgeAnalysisMode,
  KnowledgeValidityReason as SharedKnowledgeValidityReason,
} from "../../shared/enums.ts";
import { GitHeadResolver, type IGitHeadResolver } from "./git_head_resolver.ts";

export type KnowledgeValidityReason = SharedKnowledgeValidityReason;

export type KnowledgeAnalysisMode = SharedKnowledgeAnalysisMode;

export interface IKnowledgeValidityCheck {
  isValid: boolean;
  reason: KnowledgeValidityReason;
  currentSha?: string;
  cachedSha?: string;
  filesDelta?: number;
  analysisMode: KnowledgeAnalysisMode;
}

export interface IKnowledgeInvalidationStrategy {
  check(
    portalPath: string,
    cached: IPortalKnowledge,
    stalenessHours: number,
  ): Promise<IKnowledgeValidityCheck>;
}

const DEFAULT_MAX_FILES_DELTA = 20;

export class KnowledgeInvalidationStrategy implements IKnowledgeInvalidationStrategy {
  constructor(
    private readonly _gitHeadResolver: IGitHeadResolver = new GitHeadResolver(),
    private readonly _maxFilesDelta = DEFAULT_MAX_FILES_DELTA,
  ) {}

  async check(
    portalPath: string,
    cached: IPortalKnowledge,
    stalenessHours: number,
  ): Promise<IKnowledgeValidityCheck> {
    const cachedSha = cached.headCommitSha;
    if (!cachedSha) {
      return this._ttlFallback(cached, SharedKnowledgeValidityReason.NO_GIT, stalenessHours);
    }

    const currentSha = await this._gitHeadResolver.resolve(portalPath);
    if (!currentSha) {
      return this._ttlFallback(cached, SharedKnowledgeValidityReason.NO_GIT, stalenessHours, cachedSha);
    }

    if (currentSha === cachedSha) {
      return {
        isValid: true,
        reason: SharedKnowledgeValidityReason.SHA_MATCH,
        currentSha,
        cachedSha,
        analysisMode: SharedKnowledgeAnalysisMode.SKIP,
      };
    }

    const changedFiles = await this._gitHeadResolver.changedFilesSince(
      portalPath,
      cachedSha,
    );

    if (changedFiles === null) {
      return {
        isValid: false,
        reason: SharedKnowledgeValidityReason.ERROR_FALLBACK,
        currentSha,
        cachedSha,
        analysisMode: SharedKnowledgeAnalysisMode.FULL,
      };
    }

    const filesDelta = changedFiles.length;
    return {
      isValid: false,
      reason: SharedKnowledgeValidityReason.SHA_MISMATCH,
      currentSha,
      cachedSha,
      filesDelta,
      analysisMode: filesDelta <= this._maxFilesDelta
        ? SharedKnowledgeAnalysisMode.INCREMENTAL
        : SharedKnowledgeAnalysisMode.FULL,
    };
  }

  private _ttlFallback(
    cached: IPortalKnowledge,
    reason: KnowledgeValidityReason,
    stalenessHours: number,
    cachedSha?: string,
  ): IKnowledgeValidityCheck {
    const cutoff = new Date(Date.now() - stalenessHours * 60 * 60 * 1000);
    const isFresh = new Date(cached.gatheredAt) >= cutoff;

    return {
      isValid: isFresh,
      reason,
      cachedSha,
      analysisMode: isFresh ? SharedKnowledgeAnalysisMode.SKIP : SharedKnowledgeAnalysisMode.FULL,
    };
  }
}
