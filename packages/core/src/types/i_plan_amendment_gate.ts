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
  processAmendment(input: {
    planId: string;
    stepLabel: string;
    trigger: IPlanAmendmentTrigger;
    remainingSteps?: Array<{ number: number; title: string; content: string }>;
    sharedContext?: LogMetadata;
  }): Promise<IPlanAmendmentDecision>;

  applyApprovedAmendment(planContent: string, patch: IPlanAmendmentPatch): Promise<string>;
}
