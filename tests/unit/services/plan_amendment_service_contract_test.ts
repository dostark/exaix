// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanAmendmentServiceContractTest
 * @path tests/unit/services/plan_amendment_service_contract_test.ts
 * @description Contract tests for PlanAmendmentService ensuring interface compliance and lifecycle behavior.
 * @related-files [src/services/plan/plan_amendment_service.ts, "packages/core/src/types/i_plan_amendment_service.ts"]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { PlanAmendmentService } from "../../../src/services/plan/plan_amendment_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IGenerateResult, IModelProvider } from "@exaix/ai/types.ts";
import type { IPlanAmendmentPatch, IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import type { IPlanStep } from "../../../src/services/plan/plan_executor.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

/**
 * Helper to bypass strict casting rules in tests without using double casting.
 */
function castTo<T>(val: any): T {
  return val as T;
}

function makeResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "m",
    provider: "p",
    cost_usd: 0,
  };
}

Deno.test("PlanAmendmentService implements IPlanAmendmentService interface", () => {
  const config = createMockConfig("/tmp/test");
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  // Verify all interface methods exist
  assertEquals(typeof service.shouldAmend, "function");
  assertEquals(typeof service.proposeAmendment, "function");
  assertEquals(typeof service.applyApprovedAmendment, "function");
});

Deno.test("shouldAmend returns false when amendment is disabled in config", async () => {
  const _config = createMockConfig("/tmp/test");
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(castTo<Config>({}), mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Low score",
    stepId: "1",
    confidenceScore: 30,
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, false);
});

Deno.test("shouldAmend returns true for tool_error source when enabled", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "tool_error",
    reason: "Tool failed",
    stepId: "2",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend returns true for manual_request source when enabled", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "manual_request",
    reason: "User requested",
    stepId: "3",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend returns true when confidence score is below threshold", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score too low",
    stepId: "1",
    confidenceScore: 45,
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend returns false when confidence score is above threshold", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score acceptable",
    stepId: "1",
    confidenceScore: 75,
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, false);
});

Deno.test("shouldAmend returns false for context_mismatch without confidence score", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "context_mismatch",
    reason: "Context doesn't match",
    stepId: "1",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, false);
});

Deno.test("proposeAmendment generates valid patch from LLM response", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };

  const mockLlm = castTo<IModelProvider>({
    generate: () =>
      Promise.resolve(
        makeResult(
          JSON.stringify({
            summary: "Adjusted remaining steps based on tool output",
            affectedRemainingStepIds: ["2", "3"],
            adds: [{ number: 4, title: "New Step", content: "New content" }],
            updates: [{ number: 2, title: "Updated Step", content: "Updated content" }],
            removes: ["3"],
          }),
        ),
      ),
  });

  const service = new PlanAmendmentService(config, mockLlm);

  const remainingSteps: IPlanStep[] = [
    { number: 2, title: "Step 2", content: "Content 2" },
    { number: 3, title: "Step 3", content: "Content 3" },
  ];

  const trigger: IPlanAmendmentTrigger = {
    source: "tool_error",
    reason: "Tool failed to execute",
    stepId: "1",
  };

  const patch = await service.proposeAmendment({
    planId: "test-plan-id",
    remainingSteps,
    trigger,
  });

  assertEquals(patch.planId, "test-plan-id");
  assertEquals(patch.summary, "Adjusted remaining steps based on tool output");
  assertEquals(patch.affectedRemainingStepIds, ["2", "3"]);
  assertEquals(patch.adds.length, 1);
  assertEquals(patch.updates.length, 1);
  assertEquals(patch.removes, ["3"]);
});

Deno.test("proposeAmendment handles markdown-wrapped JSON from LLM", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };

  const mockLlm = castTo<IModelProvider>({
    generate: () =>
      Promise.resolve(
        makeResult(
          `\`\`\`json
{
  "summary": "Markdown wrapped response",
  "affectedRemainingStepIds": ["2"],
  "adds": [],
  "updates": [{ "number": 2, "title": "Updated", "content": "New content" }],
  "removes": []
}
\`\`\``,
        ),
      ),
  });

  const service = new PlanAmendmentService(config, mockLlm);

  const remainingSteps: IPlanStep[] = [
    { number: 2, title: "Step 2", content: "Content 2" },
  ];

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Low confidence",
    stepId: "1",
    confidenceScore: 30,
  };

  const patch = await service.proposeAmendment({
    planId: "test-plan",
    remainingSteps,
    trigger,
  });

  assertEquals(patch.summary, "Markdown wrapped response");
  assertEquals(patch.updates.length, 1);
});

Deno.test("proposeAmendment sanitizes summary field", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };

  // Create a long summary that should be capped
  const longSummary = "A".repeat(600);

  const mockLlm = castTo<IModelProvider>({
    generate: () =>
      Promise.resolve(
        makeResult(
          JSON.stringify({
            summary: longSummary,
            affectedRemainingStepIds: ["2"],
            adds: [],
            updates: [],
            removes: [],
          }),
        ),
      ),
  });

  const service = new PlanAmendmentService(config, mockLlm);

  const remainingSteps: IPlanStep[] = [
    { number: 2, title: "Step 2", content: "Content 2" },
  ];

  const trigger: IPlanAmendmentTrigger = {
    source: "tool_error",
    reason: "Tool error",
    stepId: "1",
  };

  const patch = await service.proposeAmendment({
    planId: "test-plan",
    remainingSteps,
    trigger,
  });

  // Verify summary is capped at 500 chars
  assertEquals(patch.summary.length <= 500, true, `Summary length ${patch.summary.length} should be <= 500`);
});

Deno.test("proposeAmendment rejects invalid LLM JSON", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };

  const mockLlm = castTo<IModelProvider>({
    generate: () => Promise.resolve(makeResult("invalid json response")),
  });

  const service = new PlanAmendmentService(config, mockLlm);

  const remainingSteps: IPlanStep[] = [
    { number: 2, title: "Step 2", content: "Content 2" },
  ];

  const trigger: IPlanAmendmentTrigger = {
    source: "tool_error",
    reason: "Tool error",
    stepId: "1",
  };

  await assertRejects(
    async () => {
      await service.proposeAmendment({
        planId: "test-plan",
        remainingSteps,
        trigger,
      });
    },
    Error,
    "Failed to parse amendment proposal",
  );
});

Deno.test("applyApprovedAmendment preserves non-step content in plan", () => {
  const service = new PlanAmendmentService(castTo<Config>({}), castTo<IModelProvider>({}));

  const planContent = readFixtureTextSync(
    import.meta.url,
    "unit",
    "services",
    "plan_amendment_service_contract_test",
    "planContent.md",
  );
  const patch: IPlanAmendmentPatch = {
    amendmentId: crypto.randomUUID(),
    planId: "req-1",
    affectedRemainingStepIds: ["2"],
    summary: "Minor adjustment",
    adds: [],
    updates: [{ number: 2, title: "Execute Updated", content: "Updated execution logic" }],
    removes: [],
    createdAt: new Date().toISOString(),
  };

  const updated = service.applyApprovedAmendment(planContent, patch);

  // Verify non-step sections are preserved
  assertEquals(updated.includes("# Implementation Plan"), true);
  assertEquals(updated.includes("## Overview"), true);
  assertEquals(updated.includes("This is the overview section"), true);
  assertEquals(updated.includes("## Notes"), true);
  assertEquals(updated.includes("Additional notes section"), true);
});

Deno.test("applyApprovedAmendment throws on invalid plan content", () => {
  const service = new PlanAmendmentService(castTo<Config>({}), castTo<IModelProvider>({}));

  const invalidPlanContent = "This is not a valid plan with no frontmatter or steps";

  const patch: IPlanAmendmentPatch = {
    amendmentId: crypto.randomUUID(),
    planId: "req-1",
    affectedRemainingStepIds: ["1"],
    summary: "Test",
    adds: [],
    updates: [],
    removes: [],
    createdAt: new Date().toISOString(),
  };

  try {
    service.applyApprovedAmendment(invalidPlanContent, patch);
    throw new Error("Expected error was not thrown");
  } catch (error) {
    if (error instanceof Error) {
      assertEquals(error.message.includes("Could not parse structured plan steps from markdown"), true);
    } else {
      throw error;
    }
  }
});
