/**
 * @module PlanAmendmentServiceTest
 * @path tests/unit/services/plan_amendment_service_test.ts
 * @description Unit tests for PlanAmendmentService, validating patch application logic.
 */

import { assertEquals } from "@std/assert";
import { PlanAmendmentService } from "../../../src/services/plan/plan_amendment_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { PlanStatus } from "@exaix/core";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";
import { castAny as castTo } from "../../helpers/test_helpers.ts";

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

  assertEquals(updated.includes(`status: ${PlanStatus.APPROVED}`), true);
  assertEquals(updated.includes("## Step 2: title 2 updated"), true);
  assertEquals(updated.includes("content 2 updated"), true);
  assertEquals(updated.includes("## Step 3: title 3"), true);
  assertEquals(updated.includes("content 3"), true);
  assertEquals(updated.includes("## Next Steps"), true);
  assertEquals(updated.includes("## Step 1: title 1"), true);
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

  assertEquals(updated.includes("## Step 1: title 1"), true);
  assertEquals(updated.includes("## Step 2: title 2"), false);
});
