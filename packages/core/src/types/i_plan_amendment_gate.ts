/**
 * @module IPlanAmendmentGate
 * @path packages/core/src/types/i_plan_amendment_gate.ts
 * @description Standard interface for the plan amendment gate, wrapping proposal, HITL approval, and application.
 * @architectural-layer Shared/Interfaces
 * @related-files ["packages/core/src/planning/plan_amendment_gate.ts", "packages/core/src/planning/plan_amendment_service.ts", "packages/schemas/src/plan_amendment.ts"]
 */

import type { LogMetadata } from "./json.ts";
import type {
  IPlanAmendmentDecision,
  IPlanAmendmentPatch,
  IPlanAmendmentTrigger,
} from "@exaix/schemas/plan_amendment.ts";

export interface IPlanAmendmentGate {
  proposeAmendment(input: {
    planId: string;
    stepLabel: string;
    trigger: IPlanAmendmentTrigger;
    remainingSteps?: Array<{ number: number; title: string; content: string }>;
    sharedContext?: LogMetadata;
    traceId?: string;
  }): Promise<IPlanAmendmentPatch>;

  processAmendment(input: {
    planId: string;
    stepLabel: string;
    trigger: IPlanAmendmentTrigger;
    remainingSteps?: Array<{ number: number; title: string; content: string }>;
    sharedContext?: LogMetadata;
    traceId?: string;
  }): Promise<IPlanAmendmentDecision>;

  recordDecision(input: {
    planId: string;
    amendmentId: string | null;
    decision: IPlanAmendmentDecision["decision"];
    decidedBy: string;
    rationale?: string;
    requestId?: string;
    timestamp?: string;
    traceId?: string;
  }): Promise<void>;

  applyApprovedAmendment(
    planContent: string,
    patch: IPlanAmendmentPatch,
    traceId?: string,
  ): Promise<string>;
}
