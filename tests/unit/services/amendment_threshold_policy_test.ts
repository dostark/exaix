// deno-lint-ignore-file no-explicit-any
/**
 * @module AmendmentThresholdPolicyTest
 * @path tests/unit/services/amendment_threshold_policy_test.ts
 * @description Unit tests for amendment threshold policy and config-driven trigger behavior.
 * @related-files [src/services/plan/plan_amendment_service.ts, src/shared/schemas/config.ts]
 */

import { assertEquals } from "@std/assert";
import { PlanAmendmentService } from "../../../src/services/plan/plan_amendment_service.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import { DEFAULT_AMENDMENT_THRESHOLD } from "@exaix/core";
import { createMockConfig } from "../../helpers/config.ts";

/**
 * Helper to bypass strict casting rules in tests without using double casting.
 */
function castTo<T>(val: any): T {
  return val as T;
}

Deno.test("DEFAULT_AMENDMENT_THRESHOLD is 60", () => {
  assertEquals(DEFAULT_AMENDMENT_THRESHOLD, 60);
});

Deno.test("shouldAmend uses config threshold when confidence score is below", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 40, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score below custom threshold",
    stepId: "1",
    confidenceScore: 35,
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend uses config threshold when confidence score is at threshold", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 50, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score at threshold",
    stepId: "1",
    confidenceScore: 50,
  };

  const result = await service.shouldAmend(trigger);
  // At threshold should NOT trigger (must be BELOW threshold)
  assertEquals(result, false);
});

Deno.test("shouldAmend uses default threshold when config threshold is undefined", async () => {
  const _config = createMockConfig("/tmp/test");
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(
    castTo<Config>({ amendment: { enabled: true, expiryMs: 86_400_000 } }),
    mockLlm,
  );

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Testing default threshold",
    stepId: "1",
    confidenceScore: 55,
  };

  const result = await service.shouldAmend(trigger);
  // 55 < 60 (default threshold) should trigger
  assertEquals(result, true);
});

Deno.test("shouldAmend returns false when amendment is disabled", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: false, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "tool_error",
    reason: "Tool failed",
    stepId: "1",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, false);
});

Deno.test("shouldAmend handles boundary confidence scores", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  // Score of 0 should always trigger
  const triggerZero: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Zero confidence",
    stepId: "1",
    confidenceScore: 0,
  };
  assertEquals(await service.shouldAmend(triggerZero), true);

  // Score of 100 should never trigger
  const triggerMax: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Perfect confidence",
    stepId: "1",
    confidenceScore: 100,
  };
  assertEquals(await service.shouldAmend(triggerMax), false);
});

Deno.test("shouldAmend tool_error triggers regardless of threshold", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 10, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "tool_error",
    reason: "Tool execution failed",
    stepId: "2",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend manual_request triggers regardless of threshold", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 10, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "manual_request",
    reason: "User requested amendment",
    stepId: "3",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend context_mismatch does not trigger without explicit handling", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 60, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  const trigger: IPlanAmendmentTrigger = {
    source: "context_mismatch",
    reason: "Context doesn't match expected state",
    stepId: "1",
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, false);
});

Deno.test("shouldAmend with high threshold only triggers on very low confidence", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold: 90, expiryMs: 86_400_000 };
  const mockLlm = castTo<IModelProvider>({});
  const service = new PlanAmendmentService(config, mockLlm);

  // Score of 85 should trigger (below 90)
  const triggerLow: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Below high threshold",
    stepId: "1",
    confidenceScore: 85,
  };
  assertEquals(await service.shouldAmend(triggerLow), true);

  // Score of 95 should not trigger (above 90)
  const triggerHigh: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Above high threshold",
    stepId: "1",
    confidenceScore: 95,
  };
  assertEquals(await service.shouldAmend(triggerHigh), false);
});
