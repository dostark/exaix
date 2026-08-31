/**
 * @module RequestQualityGate
 * @path packages/quality-gate/src/request_quality_gate.ts
 * @description Orchestrates request quality assessment, optional LLM enrichment,
 * and clarification session management. Acts as the entry-point for the quality
 * gate pipeline, delegating to HeuristicAssessor, LlmQualityAssessor,
 * and RequestEnricherLlm based on configuration and score thresholds.
 * @architectural-layer Domain
 * @related-files [packages/quality-gate/mod.ts, "packages/core/src/types/i_request_quality_gate_service.ts"]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IOutputValidator } from "./internal_types.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { IRequestQualityAssessment, IRequestQualityIssue } from "@exaix/schemas/request_quality_assessment.ts";
import { RequestQualityLevel, RequestQualityRecommendation } from "@exaix/schemas/request_quality_assessment.ts";
import { ClarificationSessionStatus, type IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import type { IRequestQualityContext, IRequestQualityGateConfig, IRequestQualityGateService } from "@exaix/core/types";
import { QualityGateMode } from "@exaix/core";
import {
  DEFAULT_MAX_CLARIFICATION_ROUNDS,
  DEFAULT_QG_ENRICHMENT_THRESHOLD,
  DEFAULT_QG_MINIMUM_THRESHOLD,
  DEFAULT_QG_PROCEED_THRESHOLD,
} from "@exaix/core";
import { assessHeuristic } from "./heuristic_assessor.ts";
import { LlmQualityAssessor } from "./llm_assessor.ts";
import { enrichRequest } from "./request_enricher_llm.ts";
import { ClarificationEngine } from "./clarification_engine.ts";

// Config factory

/** TOML-derived quality-gate input before defaults are applied. */
export interface IQualityGateTomlConfig {
  enabled?: boolean;
  mode?: QualityGateMode | string;
  auto_enrich?: boolean;
  block_unactionable?: boolean;
  max_clarification_rounds?: number;
  thresholds?: {
    minimum?: number;
    enrichment?: number;
    proceed?: number;
  };
}

/** Converts TOML values to runtime config with project defaults. */
export function buildQualityGateConfig(
  cfg: IQualityGateTomlConfig,
): IRequestQualityGateConfig {
  return {
    enabled: cfg.enabled ?? true,
    mode: (cfg.mode as QualityGateMode) ?? QualityGateMode.HYBRID,
    autoEnrich: cfg.auto_enrich ?? true,
    blockUnactionable: cfg.block_unactionable ?? false,
    maxClarificationRounds: cfg.max_clarification_rounds ?? DEFAULT_MAX_CLARIFICATION_ROUNDS,
    thresholds: {
      minimum: cfg.thresholds?.minimum ?? DEFAULT_QG_MINIMUM_THRESHOLD,
      enrichment: cfg.thresholds?.enrichment ?? DEFAULT_QG_ENRICHMENT_THRESHOLD,
      proceed: cfg.thresholds?.proceed ?? DEFAULT_QG_PROCEED_THRESHOLD,
    },
  };
}

/** Centralizes config-derived gate construction for callers without an injected gate. */
export function buildRequestQualityGateFromConfig(
  cfg: IQualityGateTomlConfig,
  provider: Opt<IModelProvider, Reason.OptionalDependency>,
  validator: Opt<IOutputValidator, Reason.OptionalDependency>,
  eventLogger: Opt<IEventLogger, Reason.OptionalDependency>,
): RequestQualityGate {
  return new RequestQualityGate(buildQualityGateConfig(cfg), provider, validator, eventLogger);
}

// RequestQualityGate

/** Applies configured heuristic, LLM, or hybrid request-quality assessment. */
export class RequestQualityGate implements IRequestQualityGateService {
  private readonly provider?: IModelProvider;
  private readonly validator?: IOutputValidator;
  private readonly eventLogger?: IEventLogger;
  private readonly config: IRequestQualityGateConfig;
  private readonly engine?: ClarificationEngine;

  constructor(
    config: IRequestQualityGateConfig,
    provider?: Opt<IModelProvider, Reason.OptionalDependency>,
    validator?: Opt<IOutputValidator, Reason.OptionalDependency>,
    eventLogger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.config = config;
    this.provider = provider;
    this.validator = validator;
    this.eventLogger = eventLogger;

    if (provider && validator) {
      this.engine = new ClarificationEngine(provider, validator, {
        maxRounds: this.config.maxClarificationRounds,
      });
    }
  }

  // IRequestQualityGateService — assess

  async assess(
    requestText: string,
    context?: Opt<IRequestQualityContext, Reason.OptionalContext>,
  ): Promise<IRequestQualityAssessment> {
    const start = performance.now();

    if (!this.config.enabled) {
      return this._buildProceedResult(start);
    }

    let result = await this._runAssessment(requestText);

    // Override recommendation when blockUnactionable is set
    if (
      this.config.blockUnactionable &&
      result.score < this.config.thresholds.minimum
    ) {
      result = { ...result, recommendation: RequestQualityRecommendation.REJECT };
    }

    // Auto-enrich when configured and recommended
    if (
      this.config.autoEnrich &&
      result.recommendation === RequestQualityRecommendation.AUTO_ENRICH &&
      this.provider
    ) {
      const enrichedBody = await enrichRequest(this.provider, requestText, result.issues);
      result = { ...result, enrichedBody };
    }

    // Log to activity journal
    if (this.eventLogger) {
      await this.eventLogger.log({
        action: "request.quality_assessed",
        target: context?.requestId ?? "unknown",
        payload: {
          score: result.score,
          recommendation: result.recommendation,
          issueCount: result.issues.length,
        },
      });
    }

    return result;
  }

  // IRequestQualityGateService — enrich

  enrich(requestText: string, issues: IRequestQualityIssue[]): Promise<string> {
    if (!this.provider) return Promise.resolve(requestText);
    return enrichRequest(this.provider, requestText, issues);
  }

  // IRequestQualityGateService — clarification

  async startClarification(
    requestId: string,
    body: string,
  ): Promise<IClarificationSession> {
    if (this.engine) {
      return await this.engine.startSession(requestId, body);
    }
    // Fallback if engine cannot be initialized (no LLM)
    const heuristic = assessHeuristic(body);
    return {
      requestId,
      originalBody: body,
      rounds: [],
      status: ClarificationSessionStatus.ACTIVE,
      qualityHistory: [{ round: 0, score: heuristic.score, level: heuristic.level }],
    };
  }

  async submitAnswers(
    session: IClarificationSession,
    answers: Record<string, string>,
  ): Promise<IClarificationSession> {
    if (this.engine) {
      return await this.engine.processAnswers(session, answers);
    }
    return session;
  }

  isSessionComplete(session: IClarificationSession): boolean {
    if (this.engine) {
      return this.engine.isComplete(session);
    }
    return true;
  }

  // Private helpers

  private async _runAssessment(requestText: string): Promise<IRequestQualityAssessment> {
    const { minimum, proceed } = this.config.thresholds;

    switch (this.config.mode) {
      case QualityGateMode.HEURISTIC:
        return assessHeuristic(requestText);

      case QualityGateMode.LLM:
        if (this.provider && this.validator) {
          return await new LlmQualityAssessor(this.provider, this.validator).assess(requestText);
        }
        return assessHeuristic(requestText);

      case QualityGateMode.HYBRID: {
        const heuristic = assessHeuristic(requestText);
        // Clear pass or clear fail — no need for expensive LLM call
        if (heuristic.score >= proceed || heuristic.score < minimum) {
          return heuristic;
        }
        // Borderline range — escalate to LLM for nuanced judgment
        if (this.provider && this.validator) {
          return await new LlmQualityAssessor(this.provider, this.validator).assess(requestText);
        }
        return heuristic;
      }

      default:
        return assessHeuristic(requestText);
    }
  }

  private _buildProceedResult(start: number): IRequestQualityAssessment {
    return {
      score: 100,
      level: RequestQualityLevel.EXCELLENT,
      issues: [],
      recommendation: RequestQualityRecommendation.PROCEED,
      metadata: {
        assessedAt: new Date().toISOString(),
        mode: this.config.mode,
        durationMs: Math.round(performance.now() - start),
      },
    };
  }
}
