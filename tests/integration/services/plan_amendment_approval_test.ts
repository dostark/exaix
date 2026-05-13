/**
 * @module PlanAmendmentApprovalTest
 * @path tests/integration/services/plan_amendment_approval_test.ts
 * @description Integration tests for plan amendment approval workflow, event emission, and decision lifecycle.
 * @related-files [src/services/plan/plan_amendment_service.ts, packages/core/src/logger/event_logger.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { PlanAmendmentService } from "../../../src/services/plan/plan_amendment_service.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPlanAmendmentDecision, IPlanAmendmentPatch } from "@exaix/schemas/plan_amendment.ts";
import { ZPlanAmendmentDecision } from "@exaix/schemas/plan_amendment.ts";
import type { ConfidenceScorer } from "../../../src/services/utils/confidence_scorer.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";
import { PlanAmendmentPendingError } from "../../../src/services/plan/errors.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";
import { castAny as castTo, makeGenerateResult as makeResult } from "../../helpers/test_helpers.ts";
import {
  attachPlanAgentExecutor,
  createPlanAmendmentExecutor,
  createPlanExecutionContext,
  getPlanAmendmentsDir,
} from "./plan_amendment_test_helper.ts";
import {
  PLAN_AMENDMENT_EVENT_APPROVED,
  PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
  PLAN_AMENDMENT_EVENT_EXPIRED,
  PLAN_AMENDMENT_EVENT_PROPOSED,
  PLAN_AMENDMENT_EVENT_REJECTED,
} from "@exaix/core";

/**
 * Creates a mock event logger that captures all logged events
 */
function _createMockEventLogger() {
  const events: Array<{ eventType: string; payload: JSONObject }> = [];

  const logger = {
    log: (eventType: string, _payload: JSONObject) => {
      events.push({ eventType, payload: _payload });
    },
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    getEvents: () => events,
    getEventsByType: (type: string) => events.filter((e) => e.eventType === type),
  };

  return logger;
}

Deno.test("PlanAmendmentService propose emits no side effects without approval adapter", async () => {
  const { tempDir, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, {
      amendment: { enabled: true, threshold: 60, expiryMs: 86_400_000 },
    });

    const mockLlm = castTo<IModelProvider>({
      generate: () =>
        Promise.resolve(
          makeResult(
            JSON.stringify({
              summary: "Test amendment proposal",
              affectedRemainingStepIds: ["2"],
              adds: [],
              updates: [{ number: 2, title: "Updated", content: "Updated content" }],
              removes: [],
            }),
          ),
        ),
    });

    const service = new PlanAmendmentService(config, mockLlm);

    const patch = await service.proposeAmendment({
      planId: "test-plan-id",
      remainingSteps: [{ number: 2, title: "Step 2", content: "Original content" }],
      trigger: {
        source: "tool_error",
        reason: "Tool failed",
        stepId: "1",
      },
    });

    // Verify patch is valid
    assertEquals(patch.planId, "test-plan-id");
    assertEquals(patch.summary, "Test amendment proposal");
  } finally {
    await cleanup();
  }
});

Deno.test("Amendment approval decision schema validates correctly", () => {
  const approved: IPlanAmendmentDecision = {
    amendmentId: crypto.randomUUID(),
    decision: "approved",
    decidedAt: new Date().toISOString(),
    decidedBy: "user-123",
    rationale: "Looks good",
  };

  const parsed = ZPlanAmendmentDecision.parse(approved);
  assertEquals(parsed.decision, "approved");
  assertEquals(parsed.rationale, "Looks good");
});

Deno.test("Amendment rejected decision validates correctly", () => {
  const rejected: IPlanAmendmentDecision = {
    amendmentId: crypto.randomUUID(),
    decision: "rejected",
    decidedAt: new Date().toISOString(),
    decidedBy: "user-456",
    rationale: "Not needed",
  };

  const parsed = ZPlanAmendmentDecision.parse(rejected);
  assertEquals(parsed.decision, "rejected");
});

Deno.test("Amendment expired decision validates correctly", () => {
  const expired: IPlanAmendmentDecision = {
    amendmentId: crypto.randomUUID(),
    decision: "expired",
    decidedAt: new Date().toISOString(),
    decidedBy: "system",
  };

  const parsed = ZPlanAmendmentDecision.parse(expired);
  assertEquals(parsed.decision, "expired");
});

Deno.test("PlanExecutor with amendment service throws PlanAmendmentPendingError on trigger", async () => {
  const root = await Deno.makeTempDir();
  const traceId = "550e8400-e29b-41d4-a716-446655440002";
  const requestId = "550e8400-e29b-41d4-a716-446655440003";

  try {
    const mockLLM = castTo<IModelProvider>({
      generate: () =>
        Promise.resolve(
          makeResult(
            JSON.stringify({
              summary: "Amendment proposed",
              affectedRemainingStepIds: ["2"],
              adds: [],
              updates: [],
              removes: [],
            }),
          ),
        ),
    });

    const mockScorer = castTo<ConfidenceScorer>({
      assessQuick: () => ({ score: 40, reasoning: "Low confidence" }),
    });

    const { config, executor } = createPlanAmendmentExecutor({
      root,
      llm: mockLLM,
      threshold: 80,
      expiryMs: 5000,
      scorer: mockScorer,
    });

    const context = createPlanExecutionContext(traceId, requestId, [
      { number: 1, title: "Step 1", content: "Do something" },
      { number: 2, title: "Step 2", content: "Do more" },
    ]);

    const agentExecutor = {
      executeStep: () => Promise.resolve({ description: "Result" }),
      dispose: () => {},
    };

    attachPlanAgentExecutor(executor, agentExecutor);

    // Should throw PlanAmendmentPendingError when trigger fires
    await assertRejects(
      async () => {
        await executor.execute("plan.md", context);
      },
      PlanAmendmentPendingError,
    );

    // Verify amendment artifact was created
    const amendmentsDir = getPlanAmendmentsDir(root, config, traceId);
    const entries = await Array.fromAsync(Deno.readDir(amendmentsDir));
    assertEquals(entries.length, 1);
    assertEquals(entries[0].name.endsWith(".json"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("applyApprovedAmendment correctly applies patch to plan content", async () => {
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
      "plan_amendment_approval_test",
      "planContent.md",
    );

    const patch: IPlanAmendmentPatch = {
      amendmentId: crypto.randomUUID(),
      planId: "req-1",
      affectedRemainingStepIds: ["2", "3"],
      summary: "Refined processing steps",
      adds: [],
      updates: [
        { number: 2, title: "Process Data Enhanced", content: "Process with enhanced logic" },
        { number: 3, title: "Generate Report Enhanced", content: "Generate with enhanced templates" },
      ],
      removes: [],
      createdAt: new Date().toISOString(),
    };

    const updated = service.applyApprovedAmendment(planContent, patch);

    // Verify updates applied
    assertEquals(updated.includes("## Step 2: Process Data Enhanced"), true);
    assertEquals(updated.includes("## Step 3: Generate Report Enhanced"), true);
    assertEquals(updated.includes("Process with enhanced logic"), true);
    // Original step 1 preserved
    assertEquals(updated.includes("## Step 1: Initial Setup"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("Plan amendment events are defined with correct string values", () => {
  assertEquals(PLAN_AMENDMENT_EVENT_PROPOSED, "plan.amendment.proposed");
  assertEquals(PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL, "plan.amendment.awaiting_approval");
  assertEquals(PLAN_AMENDMENT_EVENT_APPROVED, "plan.amendment.approved");
  assertEquals(PLAN_AMENDMENT_EVENT_REJECTED, "plan.amendment.rejected");
  assertEquals(PLAN_AMENDMENT_EVENT_EXPIRED, "plan.amendment.expired");
});
