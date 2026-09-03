/**
 * @module IRequestQualityGateService
 * @path packages/core/src/types/i_request_quality_gate_service.ts
 * @description Service interface and configuration type for RequestQualityGate,
 * which evaluates incoming request quality, auto-enriches underspecified
 * requests, and manages the multi-turn clarification Q&A loop (Phase 47).
 * @architectural-layer Shared
 * @related-files [packages/quality-gate/src/request_quality_gate.ts, packages/core/src/types/mod.ts]
 */

import type { IClarificationSession, IRequestQualityAssessment, IRequestQualityIssue } from "@exaix/schemas";

import type { QualityGateMode } from "@exaix/core";

/**
 * Score thresholds that drive quality gate routing decisions.
 */
export interface IRequestQualityThresholds {
  /** Below this score: route to clarification or reject. Default `DEFAULT_QG_MINIMUM_THRESHOLD` (20). */
  minimum: number;
  /** Below this score (but above minimum): auto-enrich via LLM. Default `DEFAULT_QG_ENRICHMENT_THRESHOLD` (50). */
  enrichment: number;
  /** Above this score: proceed to agent/flow execution without intervention. Default `DEFAULT_QG_PROCEED_THRESHOLD` (70). */
  proceed: number;
}

/** Configuration for the RequestQualityGate service; all fields optional at construction, with sensible defaults. */
export interface IRequestQualityGateConfig {
  /** Whether the quality gate is active. When false, all requests proceed. */
  enabled: boolean;
  /** Assessment strategy: `HEURISTIC` (fast, zero-cost text signals only), `LLM` (full
   *  LLM-powered), or `HYBRID` (heuristic first, escalate to LLM for borderline scores). */
  mode: QualityGateMode;
  /** Score thresholds controlling routing decisions. */
  thresholds: IRequestQualityThresholds;
  /** When true, requests in the enrichment score range are automatically rewritten by the LLM before proceeding. */
  autoEnrich: boolean;
  /** When true, requests scoring below `thresholds.minimum` are blocked outright (not even clarification is offered). */
  blockUnactionable: boolean;
  /** Maximum Q&A rounds before forcing a proceed-with-best-effort. Default `DEFAULT_MAX_CLARIFICATION_ROUNDS` (5). */
  maxClarificationRounds: number;
}

export interface IRequestQualityContext {
  /** Request ID, for activity journal targeting. */
  requestId?: string;
  /** Agent or flow ID that will execute the request, if known. */
  agentRole?: string;
  /** Absolute path to the originating request file. */
  requestFilePath?: string;
  /** Trace ID from request frontmatter, for correlated logging. */
  traceId?: string;
}

/** Implementations MUST: return a valid `IRequestQualityAssessment` even on failure (a
 * low-confidence heuristic fallback), never throw from `assess()` (absorb errors into
 * metadata), and populate `metadata.assessedAt`/`durationMs`/`mode`. */
export interface IRequestQualityGateService {
  /** Assesses the quality of a raw request body. */
  assess(
    requestText: string,
    context?: IRequestQualityContext,
  ): Promise<IRequestQualityAssessment>;

  /** Rewrites an underspecified request body to be more actionable; called when the
   *  assessment recommendation is `auto-enrich`. */
  enrich(requestText: string, issues: IRequestQualityIssue[]): Promise<string>;

  /** Starts a new clarification session for a request that needs human input; generates
   *  the first round of questions via the planning agent. */
  startClarification(requestId: string, body: string): Promise<IClarificationSession>;

  /** Submits answers for the current round and advances the session: incorporates them,
   *  re-assesses quality, then either generates the next round or finalizes the session. */
  submitAnswers(
    session: IClarificationSession,
    answers: Record<string, string>,
  ): Promise<IClarificationSession>;

  /** Terminal states: `user-confirmed`, `agent-satisfied`, `max-rounds`, `user-cancelled`. */
  isSessionComplete(session: IClarificationSession): boolean;
}
