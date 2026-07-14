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

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

/**
 * Shape of the `quality_gate` section as stored in `Config` (TOML-derived).
 * All fields are optional because the config schema provides defaults.
 */
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

/**
 * Converts the TOML `[quality_gate]` config section into the
 * `IRequestQualityGateConfig` expected by `RequestQualityGate`.
 * All fields fall back to the project-wide defaults when absent.
 */
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

/**
 * Builds a RequestQualityGate from the TOML `[quality_gate]` config section
 * plus the provider/validator/logger a caller already has on hand. Shared by
 * any caller that constructs RequestProcessor without injecting its own gate
 * (production bootstrap, tests) so the config-driven default stays in one
 * place instead of being re-derived ad hoc.
 */
export function buildRequestQualityGateFromConfig(
  cfg: IQualityGateTomlConfig,
  provider?: IModelProvider,
  validator?: IOutputValidator,
  eventLogger?: IEventLogger,
): RequestQualityGate {
  return new RequestQualityGate(buildQualityGateConfig(cfg), provider, validator, eventLogger);
}

// ---------------------------------------------------------------------------
// RequestQualityGate
// ---------------------------------------------------------------------------

/**
 * Main service that implements the request quality gate pipeline.
 *
 * Assessment strategies:
 * - `heuristic`: zero-cost text signal analysis only (sandboxed-safe)
 * - `llm`: full LLM-powered assessment
 * - `hybrid`: heuristic first; escalate to LLM for borderline scores
 *
 * After assessment, the service optionally:
 * 1. Auto-enriches the request when `autoEnrich` is enabled and recommendation
 *    is `auto-enrich`.
 * 2. Overrides recommendation to `reject` when `blockUnactionable` is enabled
 *    and the score is below the configured minimum threshold.
 * 3. Logs `request.quality_assessed` to the activity journal when an
 *    `IEventLogger` was provided.
 */
export class RequestQualityGate implements IRequestQualityGateService {
  private readonly provider?: IModelProvider;
  private readonly validator?: IOutputValidator;
  private readonly eventLogger?: IEventLogger;
  private readonly config: IRequestQualityGateConfig;
  private readonly engine?: ClarificationEngine;

  constructor(
    config: IRequestQualityGateConfig,
    provider?: IModelProvider,
    validator?: IOutputValidator,
    eventLogger?: IEventLogger,
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

  // ---------------------------------------------------------------------------
  // IRequestQualityGateService — assess
  // ---------------------------------------------------------------------------

  async assess(
    requestText: string,
    context?: IRequestQualityContext,
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

  // ---------------------------------------------------------------------------
  // IRequestQualityGateService — enrich
  // ---------------------------------------------------------------------------

  enrich(requestText: string, issues: IRequestQualityIssue[]): Promise<string> {
    if (!this.provider) return Promise.resolve(requestText);
    return enrichRequest(this.provider, requestText, issues);
  }

  // ---------------------------------------------------------------------------
  // IRequestQualityGateService — clarification (stubbed; implemented in Step 10)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
