// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanAmendmentResumeTest
 * @path tests/integration/services/plan_amendment_resume_test.ts
 * @description Integration tests for plan amendment resume workflow after approval/rejection.
 * @related-files [src/services/plan/plan_amendment_service.ts, src/services/plan/plan_executor.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { PlanAmendmentService } from "../../../src/services/plan/plan_amendment_service.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPlanAmendmentDecision, IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import { ZPlanAmendmentDecision } from "@exaix/schemas/plan_amendment.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

/**
 * Helper to bypass strict casting rules in tests without using double casting.
 */
function castTo<T>(val: any): T {
  return val as T;
}

Deno.test("applyApprovedAmendment preserves original plan structure", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, {
      amendment: { enabled: true, threshold: 60, expiryMs: 86_400_000 },
    });

    const mockLlm = castTo<IModelProvider>({});
    const service = new PlanAmendmentService(config, mockLlm);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "integration",
      "services",
      "plan_amendment_resume_test",
      "planContent.md",
    );
    const patch: IPlanAmendmentPatch = {
      amendmentId: crypto.randomUUID(),
      planId: "req-resume-1",
      affectedRemainingStepIds: ["2", "3"],
      summary: "Enhanced processing and validation",
      adds: [],
      updates: [
        { number: 2, title: "Process Data Enhanced", content: "Process with enhanced algorithm v2" },
        { number: 3, title: "Validate Results Enhanced", content: "Validate with extended criteria" },
      ],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    const updated = service.applyApprovedAmendment(planContent, patch);

    // Verify structure preserved
    assertEquals(updated.includes("# Resume Test Plan"), true);
    assertEquals(updated.includes("## Overview"), true);
    assertEquals(updated.includes("This plan tests the resume functionality"), true);
    assertEquals(updated.includes("## Notes"), true);
    assertEquals(updated.includes("All steps must pass validation"), true);

    // Verify updates applied
    assertEquals(updated.includes("## Step 2: Process Data Enhanced"), true);
    assertEquals(updated.includes("## Step 3: Validate Results Enhanced"), true);

    // Verify status updated
    assertEquals(updated.includes("status: approved"), true);
    assertEquals(updated.includes("status: amendment_pending"), false);

    // Verify step 1 unchanged
    assertEquals(updated.includes("## Step 1: Setup Environment"), true);
    assertEquals(updated.includes("Initialize all required dependencies"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("applyApprovedAmendment handles step removal correctly", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, {
      amendment: { enabled: true, threshold: 60, expiryMs: 86_400_000 },
    });

    const mockLlm = castTo<IModelProvider>({});
    const service = new PlanAmendmentService(config, mockLlm);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "integration",
      "services",
      "plan_amendment_resume_test",
      "planContent_1.md",
    );
    const patch: IPlanAmendmentPatch = {
      amendmentId: crypto.randomUUID(),
      planId: "req-remove-1",
      affectedRemainingStepIds: ["2"],
      summary: "Remove unnecessary step",
      adds: [],
      updates: [],
      removes: ["2"],
      createdAt: new Date().toISOString(),
    };

    const updated = service.applyApprovedAmendment(planContent, patch);

    // Verify step 2 removed
    assertEquals(updated.includes("## Step 2: To Be Removed"), false);
    assertEquals(updated.includes("This step should be removed"), false);

    // Verify other steps preserved
    assertEquals(updated.includes("## Step 1: First"), true);
    assertEquals(updated.includes("## Step 3: Third"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("applyApprovedAmendment handles step addition correctly", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, {
      amendment: { enabled: true, threshold: 60, expiryMs: 86_400_000 },
    });

    const mockLlm = castTo<IModelProvider>({});
    const service = new PlanAmendmentService(config, mockLlm);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "integration",
      "services",
      "plan_amendment_resume_test",
      "planContent_2.md",
    );
    const patch: IPlanAmendmentPatch = {
      amendmentId: crypto.randomUUID(),
      planId: "req-add-1",
      affectedRemainingStepIds: [],
      summary: "Add cleanup step",
      adds: [
        { number: 2, title: "Cleanup Resources", content: "Release all allocated resources" },
      ],
      updates: [],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    const updated = service.applyApprovedAmendment(planContent, patch);

    // Verify new step added
    assertEquals(updated.includes("## Step 2: Cleanup Resources"), true);
    assertEquals(updated.includes("Release all allocated resources"), true);

    // Verify original step preserved
    assertEquals(updated.includes("## Step 1: First"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("Decision schema validates all decision types", () => {
  const amendmentId = crypto.randomUUID();
  const decidedAt = new Date().toISOString();

  // Test approved decision
  const approved: IPlanAmendmentDecision = {
    amendmentId,
    decision: "approved",
    decidedAt,
    decidedBy: "user-1",
    rationale: "Approved after review",
  };
  const approvedParsed = ZPlanAmendmentDecision.parse(approved);
  assertEquals(approvedParsed.decision, "approved");

  // Test rejected decision
  const rejected: IPlanAmendmentDecision = {
    amendmentId,
    decision: "rejected",
    decidedAt,
    decidedBy: "user-2",
    rationale: "Not aligned with goals",
  };
  const rejectedParsed = ZPlanAmendmentDecision.parse(rejected);
  assertEquals(rejectedParsed.decision, "rejected");

  // Test expired decision (no rationale required)
  const expired: IPlanAmendmentDecision = {
    amendmentId,
    decision: "expired",
    decidedAt,
    decidedBy: "system",
  };
  const expiredParsed = ZPlanAmendmentDecision.parse(expired);
  assertEquals(expiredParsed.decision, "expired");
});

Deno.test("Decision schema rejects invalid data", () => {
  const amendmentId = crypto.randomUUID();
  const decidedAt = new Date().toISOString();

  // Invalid decision type
  assertThrows(
    () =>
      ZPlanAmendmentDecision.parse({
        amendmentId,
        decision: "invalid",
        decidedAt,
        decidedBy: "user-1",
      }),
  );

  // Missing decidedBy
  assertThrows(
    () =>
      ZPlanAmendmentDecision.parse({
        amendmentId,
        decision: "approved",
        decidedAt,
      }),
  );

  // Invalid amendmentId (not UUID)
  assertThrows(
    () =>
      ZPlanAmendmentDecision.parse({
        amendmentId: "not-a-uuid",
        decision: "approved",
        decidedAt,
        decidedBy: "user-1",
      }),
  );
});
