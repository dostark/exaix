/**
 * @module PlanAmendmentGate
 * @path packages/core/src/planning/plan_amendment_gate.ts
 * @description Standalone gate class that wraps the amendment lifecycle: propose → HITL approval → apply. Integrates with IAmendmentApprovalAdapter for human-in-the-loop decisions with configurable timeout.
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/i_plan_amendment_gate.ts", "packages/core/src/planning/plan_amendment_service.ts", "packages/schemas/src/plan_amendment.ts"]
 */

import type { IPlanAmendmentGate } from "../types/i_plan_amendment_gate.ts";
import type { IPlanAmendmentService } from "../types/i_plan_amendment_service.ts";
import type { IAmendmentApprovalAdapter } from "./plan_amendment_service.ts";
import type { IEventLogger } from "../logger/event_logger.ts";
import type { LogMetadata } from "../types/json.ts";
import type {
  IPlanAmendmentDecision,
  IPlanAmendmentPatch,
  IPlanAmendmentTrigger,
} from "@exaix/schemas/plan_amendment.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { Opt, Reason } from "../types/mod.ts";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import { AmendmentTimeoutAction } from "../types/enums.ts";

const AMENDMENT_DECISION_APPROVED = "approved";
const AMENDMENT_DECISION_REJECTED = "rejected";
const AMENDMENT_DECISION_EXPIRED = "expired";
const AMENDMENT_DECIDED_BY_TIMEOUT = "timeout";

/** @visible */
export class PlanAmendmentGate implements IPlanAmendmentGate {
  constructor(
    private config: Config,
    private amendmentService: IPlanAmendmentService,
    private approvalAdapter?: Opt<IAmendmentApprovalAdapter, Reason.OptionalDependency>,
    private logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {}

  async processAmendment(input: {
    planId: string;
    stepLabel: string;
    trigger: IPlanAmendmentTrigger;
    remainingSteps?: Array<{ number: number; title: string; content: string }>;
    sharedContext?: LogMetadata;
  }): Promise<IPlanAmendmentDecision> {
    const { planId, stepLabel, trigger, remainingSteps, sharedContext } = input;

    // 1. Propose amendment via service
    const patch = await this.amendmentService.proposeAmendment({
      planId,
      remainingSteps: remainingSteps ?? [],
      trigger,
      sharedContext,
    });

    // 2. Emit proposal event
    await this.emitAmendmentEvent(DomainEventType.PlanAmendmentProposed, planId, {
      amendmentId: patch.amendmentId,
      planId,
      stepId: stepLabel,
      triggerSource: trigger.source,
    });

    // 3. Determine decision
    let decision: IPlanAmendmentDecision;

    if (this.approvalAdapter && this.config.amendment?.enabled) {
      const hitlTimeoutMs = this.config.amendment.hitl_timeout_ms ?? 300_000;
      const onTimeout = this.config.amendment.on_timeout ?? AmendmentTimeoutAction.ABORT;

      const adapterDecision = await this.raceAdapterWithTimeout(
        this.approvalAdapter,
        patch,
        hitlTimeoutMs,
        onTimeout,
      );
      decision = adapterDecision;
    } else {
      // No adapter or amendment disabled: auto-approve immediately
      decision = {
        amendmentId: patch.amendmentId,
        decision: AMENDMENT_DECISION_APPROVED,
        decidedAt: new Date().toISOString(),
        decidedBy: "auto",
        rationale: "Auto-approved (no HITL adapter configured)",
      };
    }

    // 4. Emit decision event
    const eventName = decision.decision === AMENDMENT_DECISION_APPROVED
      ? DomainEventType.PlanAmendmentApproved
      : decision.decision === AMENDMENT_DECISION_REJECTED
      ? DomainEventType.PlanAmendmentRejected
      : DomainEventType.PlanAmendmentExpired;

    await this.emitAmendmentEvent(eventName, planId, {
      amendmentId: patch.amendmentId,
      planId,
      decision: decision.decision,
      decidedBy: decision.decidedBy,
      rationale: decision.rationale,
      timestamp: new Date().toISOString(),
    });

    // 5. Return decision
    return decision;
  }

  async applyApprovedAmendment(planContent: string, patch: IPlanAmendmentPatch): Promise<string> {
    const result = this.amendmentService.applyApprovedAmendment(planContent, patch);
    await this.emitAmendmentEvent(DomainEventType.PlanAmendmentApplied, patch.planId, {
      amendmentId: patch.amendmentId,
      planId: patch.planId,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  private raceAdapterWithTimeout(
    adapter: IAmendmentApprovalAdapter,
    patch: IPlanAmendmentPatch,
    timeoutMs: number,
    onTimeout: string,
  ): Promise<IPlanAmendmentDecision> {
    const timeoutPromise = new Promise<IPlanAmendmentDecision>((resolve) => {
      setTimeout(() => {
        const now = new Date().toISOString();
        if (onTimeout === AmendmentTimeoutAction.APPROVE) {
          resolve({
            amendmentId: patch.amendmentId,
            decision: AMENDMENT_DECISION_APPROVED,
            decidedAt: now,
            decidedBy: AMENDMENT_DECIDED_BY_TIMEOUT,
            rationale: "Auto-approved due to HITL timeout",
          });
        } else if (onTimeout === AmendmentTimeoutAction.REJECT) {
          resolve({
            amendmentId: patch.amendmentId,
            decision: AMENDMENT_DECISION_REJECTED,
            decidedAt: now,
            decidedBy: AMENDMENT_DECIDED_BY_TIMEOUT,
            rationale: "Auto-rejected due to HITL timeout",
          });
        } else {
          resolve({
            amendmentId: patch.amendmentId,
            decision: AMENDMENT_DECISION_EXPIRED,
            decidedAt: now,
            decidedBy: AMENDMENT_DECIDED_BY_TIMEOUT,
            rationale: "Amendment expired due to HITL timeout",
          });
        }
      }, timeoutMs);
    });

    const adapterPromise = adapter.requestDecision(patch).then((adapterDecision) => {
      return adapterDecision;
    });

    return Promise.race([adapterPromise, timeoutPromise]);
  }

  private async emitAmendmentEvent(
    action: TDomainEventType,
    planId: string,
    payload: LogMetadata,
  ): Promise<void> {
    if (this.logger) {
      await this.logger.info(action, `plan:${planId}`, payload);
    }
  }
}
