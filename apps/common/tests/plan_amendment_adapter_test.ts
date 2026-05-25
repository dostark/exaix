/**
 * @module PlanAmendmentAdapterTest
 * @path apps/common/tests/plan_amendment_adapter_test.ts
 * @description Unit tests for the PlanAmendmentAdapter to verify delegation to the underlying service.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { PlanAmendmentAdapter } from "../../../apps/common/adapters/plan_amendment_adapter.ts";
import type { IPlanAmendmentService } from "@exaix/core/types";
import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import type { IPlanStep } from "@exaix/core/planning";
import type { JSONObject } from "@exaix/core/types";

describe("PlanAmendmentAdapter", () => {
  const patch: IPlanAmendmentPatch = {
    amendmentId: "00000000-0000-0000-0000-000000000000",
    planId: "plan-1",
    affectedRemainingStepIds: ["step-1"],
    summary: "Update next step",
    adds: [],
    updates: [],
    removes: [],
    createdAt: new Date().toISOString(),
  };

  const trigger: IPlanAmendmentTrigger = {
    source: "manual_request",
    stepId: "step-1",
    reason: "Need to adjust plan",
    confidenceScore: 90,
  };

  const remainingSteps: IPlanStep[] = [];

  it("delegates shouldAmend to the underlying service", async () => {
    const service: IPlanAmendmentService = {
      shouldAmend: (receivedTrigger) => {
        assertEquals(receivedTrigger, trigger);
        return Promise.resolve(true);
      },
      proposeAmendment: () => Promise.resolve(patch),
      applyApprovedAmendment: () => "",
    };

    const adapter = new PlanAmendmentAdapter(service);
    const result = await adapter.shouldAmend(trigger);

    assertEquals(result, true);
  });

  it("delegates proposeAmendment to the underlying service", async () => {
    const service: IPlanAmendmentService = {
      shouldAmend: () => Promise.resolve(false),
      proposeAmendment: (input) => {
        assertEquals(input.planId, "plan-1");
        return Promise.resolve(patch);
      },
      applyApprovedAmendment: () => "",
    };

    const adapter = new PlanAmendmentAdapter(service);
    const result = await adapter.proposeAmendment({
      planId: "plan-1",
      remainingSteps,
      trigger,
      sharedContext: { example: true } as JSONObject,
    });

    assertEquals(result, patch);
  });

  it("delegates applyApprovedAmendment to the underlying service", () => {
    const service: IPlanAmendmentService = {
      shouldAmend: () => Promise.resolve(false),
      proposeAmendment: () => Promise.resolve(patch),
      applyApprovedAmendment: (planContent, receivedPatch) => {
        assertEquals(planContent, "original-plan");
        assertEquals(receivedPatch, patch);
        return "patched-plan";
      },
    };

    const adapter = new PlanAmendmentAdapter(service);
    const result = adapter.applyApprovedAmendment("original-plan", patch);

    assertEquals(result, "patched-plan");
  });
});
