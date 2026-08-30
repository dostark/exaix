/**
 * @module ClarificationGateway
 * @path packages/request/src/clarification_gateway.ts
 * @description Evaluates the request quality gate and routes to rejection,
 * refinement-session delegation, or an in-process clarification session; also
 * loads a previously-completed clarification's specification when bypassing
 * re-assessment (Gap §13). Extracted from RequestProcessor (god-object
 * decomposition, .copilot/skills/refactor/SKILL.md step d) since this logic
 * is a cohesive quality/clarification flow depending on statusManager,
 * qualityGate, and two optional delegation callbacks — no other
 * RequestProcessor field.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", "packages/quality-gate/src/request_quality_gate.ts"]
 */
import { loadClarification, saveClarification } from "@exaix/quality-gate";
import { RequestQualityRecommendation } from "@exaix/schemas/request_quality_assessment.ts";
import { ClarificationSessionStatus } from "@exaix/schemas/clarification_session.ts";
import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import { RequestStatus } from "@exaix/core/status";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { IRequestQualityGateService } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { StatusManager } from "./processing/status.ts";

export type IQualityGateOutcome =
  | { earlyReturn: true }
  | { earlyReturn: false; enrichedBody?: string; specification?: IRequestSpecification };

export interface IClarificationGatewayDeps {
  statusManager: StatusManager;
  qualityGate?: IRequestQualityGateService;
  sessionDelegateEnabled?: boolean;
  sessionDelegateRefinementGate?: boolean;
  onDelegateRefinement?: (traceId: string, requestId: string, body: string) => Promise<void>;
  onClarificationCreated?: (traceId: string, requestId: string) => Promise<void>;
}

export interface IClarificationGateway {
  runQualityGate(
    body: string,
    filePath: string,
    requestId: string,
    traceLogger: IEventLogger,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): Promise<IQualityGateOutcome>;
  loadSpecFromClarification(
    filePath: string,
  ): Promise<{ earlyReturn: false; specification?: IRequestSpecification }>;
}

async function loadCompletedSpecification(filePath: string): Promise<IRequestSpecification | undefined> {
  const completedSession = await loadClarification(filePath).catch(() => null);
  return completedSession?.refinedBody &&
      (completedSession.status === ClarificationSessionStatus.AGENT_SATISFIED ||
        completedSession.status === ClarificationSessionStatus.USER_CONFIRMED)
    ? completedSession.refinedBody
    : undefined;
}

export class ClarificationGateway implements IClarificationGateway {
  private readonly statusManager: StatusManager;
  private readonly qualityGate?: IRequestQualityGateService;
  private readonly sessionDelegateEnabled: boolean;
  private readonly sessionDelegateRefinementGate: boolean;
  private readonly onDelegateRefinement?: (traceId: string, requestId: string, body: string) => Promise<void>;
  private readonly onClarificationCreated?: (traceId: string, requestId: string) => Promise<void>;

  constructor(deps: IClarificationGatewayDeps) {
    this.statusManager = deps.statusManager;
    this.qualityGate = deps.qualityGate;
    this.sessionDelegateEnabled = deps.sessionDelegateEnabled ?? false;
    this.sessionDelegateRefinementGate = deps.sessionDelegateRefinementGate ?? false;
    this.onDelegateRefinement = deps.onDelegateRefinement;
    this.onClarificationCreated = deps.onClarificationCreated;
  }

  /** Loads a completed clarification's spec, bypassing quality-gate re-assessment
   * (used when `assessed_at` is present in frontmatter). */
  async loadSpecFromClarification(
    filePath: string,
  ): Promise<{ earlyReturn: false; specification?: IRequestSpecification }> {
    const specification = await loadCompletedSpecification(filePath);
    return { earlyReturn: false, specification };
  }

  /** Evaluates quality gate and returns early-return signal or enriched body. */
  async runQualityGate(
    body: string,
    filePath: string,
    requestId: string,
    traceLogger: IEventLogger,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): Promise<IQualityGateOutcome> {
    if (!this.qualityGate) {
      // Load any completed clarification session even without an active gate
      const specification = await loadCompletedSpecification(filePath);
      return { earlyReturn: false, specification };
    }
    try {
      const qgResult = await this.qualityGate.assess(body, { requestId });
      if (qgResult.recommendation === RequestQualityRecommendation.REJECT) {
        await this.statusManager.updateStatus(filePath, RequestStatus.FAILED, "Request rejected by quality gate");
        return { earlyReturn: true };
      }
      if (qgResult.recommendation === RequestQualityRecommendation.NEEDS_CLARIFICATION) {
        if (await this.tryDelegateRefinement(filePath, requestId, body, traceId)) {
          return { earlyReturn: true };
        }
        await this.startClarificationSession(filePath, requestId, body, traceId);
        return { earlyReturn: true };
      }
      if (qgResult.recommendation === RequestQualityRecommendation.AUTO_ENRICH && qgResult.enrichedBody) {
        return { earlyReturn: false, enrichedBody: qgResult.enrichedBody };
      }
      // Load IRequestSpecification from any completed clarification session
      const specification = await loadCompletedSpecification(filePath);
      return { earlyReturn: false, specification };
    } catch {
      traceLogger.warn(DomainEventType.RequestQualityGateFailed, filePath, { requestId });
    }
    return { earlyReturn: false };
  }

  /** Returns true when delegation was initiated (brief prepared, wait parked, launch triggered). */
  private async tryDelegateRefinement(
    filePath: string,
    requestId: string,
    body: string,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<boolean> {
    if (!this.sessionDelegateEnabled || !this.sessionDelegateRefinementGate || !this.onDelegateRefinement) {
      return false;
    }
    await this.statusManager.updateStatus(filePath, RequestStatus.REFINING);
    if (traceId) {
      await this.onDelegateRefinement(traceId, requestId, body);
    }
    return true;
  }

  private async startClarificationSession(
    filePath: string,
    requestId: string,
    body: string,
    traceId?: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    await this.statusManager.updateStatus(filePath, RequestStatus.REFINING);
    try {
      const session = await this.qualityGate!.startClarification(requestId, body);
      await saveClarification(filePath, session);
      if (traceId && this.onClarificationCreated) {
        await this.onClarificationCreated(traceId, requestId);
      }
    } catch {
      // Session start failed; REFINING status is preserved
    }
  }
}
