/**
 * @module PlanAmendmentResumeTest
 * @path tests/integration/services/plan_amendment_resume_test.ts
 * @description Integration tests for plan amendment resume workflow after approval/rejection.
 * @related-files [@exaix/core/planning, @exaix/core/planning]
 */

import { assertEquals, assertFalse, assertStringIncludes, assertThrows } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPlanAmendmentDecision, IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import { ZPlanAmendmentDecision } from "@exaix/schemas/plan_amendment.ts";
import { readFixtureTextSync } from "@exaix/testing";
import { castAny as castTo } from "@exaix/testing";
import { createPlanAmendmentServiceForTest } from "./plan_amendment_test_helper.ts";

Deno.test("applyApprovedAmendment preserves original plan structure", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const mockLlm = castTo<IModelProvider>({});
    const { service } = createPlanAmendmentServiceForTest({ root: tempDir, llm: mockLlm });

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
    assertStringIncludes(updated, "# Resume Test Plan");
    assertStringIncludes(updated, "## Overview");
    assertStringIncludes(updated, "This plan tests the resume functionality");
    assertStringIncludes(updated, "## Notes");
    assertStringIncludes(updated, "All steps must pass validation");

    // Verify updates applied
    assertStringIncludes(updated, "## Step 2: Process Data Enhanced");
    assertStringIncludes(updated, "## Step 3: Validate Results Enhanced");

    // Verify status updated
    assertStringIncludes(updated, "status: approved");
    assertFalse(updated.includes("status: amendment_pending"));

    // Verify first step unchanged
    assertStringIncludes(updated, "## Step 1: Setup Environment");
    assertStringIncludes(updated, "Initialize all required dependencies");
  } finally {
    await cleanup();
  }
});

Deno.test("applyApprovedAmendment handles step removal correctly", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const mockLlm = castTo<IModelProvider>({});
    const { service } = createPlanAmendmentServiceForTest({ root: tempDir, llm: mockLlm });

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

    // Verify second step removed
    assertFalse(updated.includes("## Step 2: To Be Removed"));
    assertFalse(updated.includes("This step should be removed"));

    // Verify other steps preserved
    assertStringIncludes(updated, "## Step 1: First");
    assertStringIncludes(updated, "## Step 3: Third");
  } finally {
    await cleanup();
  }
});

Deno.test("applyApprovedAmendment handles step addition correctly", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const mockLlm = castTo<IModelProvider>({});
    const { service } = createPlanAmendmentServiceForTest({ root: tempDir, llm: mockLlm });

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
    assertStringIncludes(updated, "## Step 2: Cleanup Resources");
    assertStringIncludes(updated, "Release all allocated resources");

    // Verify original step preserved
    assertStringIncludes(updated, "## Step 1: First");
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
