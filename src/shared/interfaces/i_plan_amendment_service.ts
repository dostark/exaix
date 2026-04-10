/**
 * @module IPlanAmendmentService
 * @path src/shared/interfaces/i_plan_amendment_service.ts
 * @description Standard interface for the plan amendment service, enabling mid-execution replanning.
 * @architectural-layer Shared/Interfaces
 * @related-files [src/services/plan/plan_amendment_service.ts, src/shared/schemas/plan_amendment.ts]
 */

import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "../schemas/plan_amendment.ts";
import type { IPlanStep } from "../../services/plan/plan_executor.ts";
import type { JSONObject } from "../types/json.ts";

/**
 * Interface for the Plan Amendment Service
 */
export interface IPlanAmendmentService {
  /**
   * Evaluates if an amendment should be proposed based on a trigger
   */
  shouldAmend(trigger: IPlanAmendmentTrigger): Promise<boolean>;

  /**
   * Generates a structural patch (amendment proposal) against remaining steps
   */
  proposeAmendment(input: {
    planId: string;
    remainingSteps: IPlanStep[];
    trigger: IPlanAmendmentTrigger;
    sharedContext?: JSONObject;
  }): Promise<IPlanAmendmentPatch>;

  /**
   * Applies an approved amendment patch to the target plan content
   */
  applyApprovedAmendment(planContent: string, patch: IPlanAmendmentPatch): string;
}
