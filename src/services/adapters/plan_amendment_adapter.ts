/**
 * @module PlanAmendmentAdapter
 * @path src/services/adapters/plan_amendment_adapter.ts
 * @description Adapter for the PlanAmendmentService to expose it to the application context.
 * @architectural-layer Services/Adapters
 * @related-files [@exaix/core/planning, "packages/core/src/types/i_plan_amendment_service.ts"]
 */

import type { IPlanAmendmentService } from "@exaix/core/types";
import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import type { IPlanStep } from "@exaix/core/planning";
import type { JSONObject } from "@exaix/core/types";

/**
 * Adapter implementation of IPlanAmendmentService
 */
export class PlanAmendmentAdapter implements IPlanAmendmentService {
  constructor(private readonly service: IPlanAmendmentService) {}

  shouldAmend(trigger: IPlanAmendmentTrigger): Promise<boolean> {
    return this.service.shouldAmend(trigger);
  }

  proposeAmendment(input: {
    planId: string;
    remainingSteps: IPlanStep[];
    trigger: IPlanAmendmentTrigger;
    sharedContext?: JSONObject;
  }): Promise<IPlanAmendmentPatch> {
    return this.service.proposeAmendment(input);
  }

  applyApprovedAmendment(planContent: string, patch: IPlanAmendmentPatch): string {
    return this.service.applyApprovedAmendment(planContent, patch);
  }
}
