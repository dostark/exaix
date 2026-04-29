/**
 * @module IRequestQualityGateService
 * @path src/shared/interfaces/i_request_quality_gate_service.ts
 * @description Service interface and configuration type for RequestQualityGate,
 * which evaluates incoming request quality, auto-enriches underspecified
 * requests, and manages the multi-turn clarification Q&A loop (Phase 47).
 * @architectural-layer Shared
 * @related-files [src/services/quality_gate/request_quality_gate.ts, src/shared/interfaces/mod.ts]
 */

import type { IRequestQualityAssessment, IRequestQualityIssue } from "@exaix/schemas/request_quality_assessment.ts";
import type { IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import type { QualityGateMode } from "@exaix/core";

/**
 * Score thresholds that drive quality gate routing decisions.
 */
export interface IRequestQualityThresholds {
  /**
   * Below this score: route to clarification or reject.
   * Default: `DEFAULT_QG_MINIMUM_THRESHOLD` (20).
   */
  minimum: number;
  /**
   * Below this score (but above minimum): auto-enrich the request via LLM.
   * Default: `DEFAULT_QG_ENRICHMENT_THRESHOLD` (50).
   */
  enrichment: number;
  /**
   * Above this score: proceed to agent/flow execution without intervention.
   * Default: `DEFAULT_QG_PROCEED_THRESHOLD` (70).
   */
  proceed: number;
}

/**
 * Configuration for the RequestQualityGate service.
 * All fields are optional at construction; sensible defaults are applied.
 */
export interface IRequestQualityGateConfig {
  /** Whether the quality gate is active. When false, all requests proceed. */
  enabled: boolean;
  /**
   * Assessment strategy.
   * - `QualityGateMode.HEURISTIC`: fast, zero-cost text signal analysis only
   * - `QualityGateMode.LLM`: full LLM-powered assessment
   * - `QualityGateMode.HYBRID`: heuristic first; escalate to LLM for borderline scores
   */
  mode: QualityGateMode;
  /** Score thresholds controlling routing decisions. */
  thresholds: IRequestQualityThresholds;
  /**
   * When `true`, requests in the enrichment score range are automatically
   * rewritten by the LLM before proceeding.
   */
  autoEnrich: boolean;
  /**
   * When `true`, requests scoring below `thresholds.minimum` are blocked
   * outright (not even clarification is offered).
   */
  blockUnactionable: boolean;
  /**
   * Maximum number of Q&A rounds before forcing a proceed-with-best-effort.
   * Default: `DEFAULT_MAX_CLARIFICATION_ROUNDS` (5).
   */
  maxClarificationRounds: number;
}

/**
 * Optional context provided alongside the raw request text to improve
 * assessment accuracy.
 */
export interface IRequestQualityContext {
  /** Request ID, for activity journal targeting. */
  requestId?: string;
  /** Agent or flow ID that will execute the request, if known. */
  identityId?: string;
  /** Absolute path to the originating request file. */
  requestFilePath?: string;
  /** Trace ID from request frontmatter, for correlated logging. */
  traceId?: string;
}

/**
 * Service interface for request quality gating.
 *
 * Implementations MUST:
 * - Return a valid `IRequestQualityAssessment` even on assessment failure
 *   (fallback to a low-confidence heuristic result)
 * - Never throw from `assess()`; absorb errors and reflect them in metadata
 * - Populate `metadata.assessedAt`, `metadata.durationMs`, and `metadata.mode`
 */
export interface IRequestQualityGateService {
  /**
   * Assess the quality of a raw request body.
   *
   * @param requestText - Raw Markdown body of the request.
   * @param context     - Optional context enrichment.
   * @returns A fully populated `IRequestQualityAssessment`.
   */
  assess(
    requestText: string,
    context?: IRequestQualityContext,
  ): Promise<IRequestQualityAssessment>;

  /**
   * Rewrite an underspecified request body to be more actionable.
   * Called when the assessment recommendation is `auto-enrich`.
   *
   * @param requestText - The original request body.
   * @param issues      - Issues identified by the quality assessment.
   * @returns The enriched request body string.
   */
  enrich(requestText: string, issues: IRequestQualityIssue[]): Promise<string>;

  /**
   * Start a new clarification session for a request that requires human input.
   * Generates the first round of questions from the planning agent.
   *
   * @param requestId - ID of the request being refined.
   * @param body      - Original request body.
   * @returns A new session with Round 1 questions populated.
   */
  startClarification(requestId: string, body: string): Promise<IClarificationSession>;

  /**
   * Submit user answers to the current round's questions and advance the session.
   * The engine incorporates answers, re-assesses quality, and either generates
   * the next round or finalizes the session.
   *
   * @param session - The current session state.
   * @param answers - Map of question ID → answer text provided by the user.
   * @returns Updated session state.
   */
  submitAnswers(
    session: IClarificationSession,
    answers: Record<string, string>,
  ): Promise<IClarificationSession>;

  /**
   * Check whether a clarification session has reached a terminal state.
   * Terminal states: `user-confirmed`, `agent-satisfied`, `max-rounds`, `user-cancelled`.
   */
  isSessionComplete(session: IClarificationSession): boolean;
}
