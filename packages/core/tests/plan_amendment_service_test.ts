/**
 * @module PlanAmendmentServiceTest
 * @path packages/core/tests/plan_amendment_service_test.ts
 * @description Unit tests for PlanAmendmentService, validating patch application logic.
 */

import { assertEquals, assertFalse } from "@std/assert";
import { PlanAmendmentService } from "@exaix/core/planning";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { PlanStatus } from "@exaix/core/status";
import { readFixtureTextSync } from "@exaix/testing";
import { castAny as castTo } from "@exaix/testing";

Deno.test("PlanAmendmentService.applyApprovedAmendment correctly applies patches", () => {
  const service = new PlanAmendmentService(castTo<Config>({}), castTo<IModelProvider>({}));

  const planContent = readFixtureTextSync(
    import.meta.url,
    "unit",
    "services",
    "plan_amendment_service_test",
    "planContent.md",
  );
  const patch = {
    amendmentId: "550e8400-e29b-41d4-a716-446655440003",
    planId: "req-1",
    affectedRemainingStepIds: ["2"],
    summary: "Updated step 2 and added step 3",
    adds: [
      { number: 3, title: "title 3", content: "content 3" },
    ],
    updates: [
      { number: 2, title: "title 2 updated", content: "content 2 updated" },
    ],
    removes: [],
    createdAt: new Date().toISOString(),
  };

  const updated = service.applyApprovedAmendment(planContent, patch);

  const updatedIncludesSubject: boolean = updated.includes(`status: ${PlanStatus.APPROVED}`);
  assertEquals(updatedIncludesSubject, true, "updated should include `status: ${PlanStatus.APPROVED}`");
  const updatedIncludesStep2Title: boolean = updated.includes("## Step 2: title 2 updated");
  assertEquals(updatedIncludesStep2Title, true, "updated should include '## Step 2: title 2 updated'");
  const updatedIncludesContent2Updated: boolean = updated.includes("content 2 updated");
  assertEquals(updatedIncludesContent2Updated, true, "updated should include 'content 2 updated'");
  const updatedIncludesStep3Title: boolean = updated.includes("## Step 3: title 3");
  assertEquals(updatedIncludesStep3Title, true, "updated should include '## Step 3: title 3'");
  const updatedIncludesContent3: boolean = updated.includes("content 3");
  assertEquals(updatedIncludesContent3, true, "updated should include 'content 3'");
  const updatedIncludesNextSteps: boolean = updated.includes("## Next Steps");
  assertEquals(updatedIncludesNextSteps, true, "updated should include '## Next Steps'");
  const updatedIncludesStep1Title: boolean = updated.includes("## Step 1: title 1");
  assertEquals(updatedIncludesStep1Title, true, "updated should include '## Step 1: title 1'");
});

Deno.test("PlanAmendmentService.applyApprovedAmendment handles removals", () => {
  const service = new PlanAmendmentService(castTo<Config>({}), castTo<IModelProvider>({}));

  const planContent = readFixtureTextSync(
    import.meta.url,
    "unit",
    "services",
    "plan_amendment_service_test",
    "planContent_1.md",
  );
  const patch = {
    amendmentId: "550e8400-e29b-41d4-a716-446655440003",
    planId: "req-1",
    affectedRemainingStepIds: ["2"],
    summary: "Remove step 2",
    adds: [],
    updates: [],
    removes: ["2"],
    createdAt: new Date().toISOString(),
  };

  const updated = service.applyApprovedAmendment(planContent, patch);

  const updatedIncludesStep1Title2: boolean = updated.includes("## Step 1: title 1");
  assertEquals(updatedIncludesStep1Title2, true, "updated should include '## Step 1: title 1'");
  assertFalse(updated.includes("## Step 2: title 2"));
});
