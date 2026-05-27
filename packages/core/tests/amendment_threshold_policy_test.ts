/**
 * @module AmendmentThresholdPolicyTest
 * @path packages/core/tests/amendment_threshold_policy_test.ts
 * @description Unit tests for amendment threshold policy and config-driven trigger behavior.
 * @related-files ["packages/core/src/planning/mod.ts", "packages/schemas/src/config.ts"]
 */

import { assertEquals } from "@std/assert";
import { PlanAmendmentService } from "@exaix/core/planning";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import { DEFAULT_AMENDMENT_THRESHOLD } from "@exaix/core";
import { createMockConfig } from "@exaix/testing";
import { castAny as castTo } from "@exaix/testing";

function createService(threshold: number): PlanAmendmentService {
  const config = createMockConfig("/tmp/test");
  config.amendment = { enabled: true, threshold, expiryMs: 86_400_000, hitl_timeout_ms: 300_000, on_timeout: "abort" };
  const mockLlm = castTo<IModelProvider>({});
  return new PlanAmendmentService(config, mockLlm);
}

Deno.test("DEFAULT_AMENDMENT_THRESHOLD is 60", () => {
  assertEquals(DEFAULT_AMENDMENT_THRESHOLD, 60);
});

Deno.test("shouldAmend uses config threshold when confidence score is below", async () => {
  const service = createService(40);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score below custom threshold",
    stepId: "1",
    confidenceScore: 30,
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, true);
});

Deno.test("shouldAmend uses config threshold when confidence score is above", async () => {
  const service = createService(40);

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score above custom threshold",
    stepId: "1",
    confidenceScore: 50,
  };

  const result = await service.shouldAmend(trigger);
  assertEquals(result, false);
});

Deno.test("shouldAmend handles boundary confidence scores", async () => {
  const service = createService(60);

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
  config.amendment = {
    enabled: true,
    threshold: 50,
    expiryMs: 86_400_000,
    hitl_timeout_ms: 300_000,
    on_timeout: "abort",
  };
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
    castTo<Config>({
      amendment: { enabled: true, expiryMs: 86_400_000, hitl_timeout_ms: 300_000, on_timeout: "abort" },
    }),
    mockLlm,
  );

  const trigger: IPlanAmendmentTrigger = {
    source: "low_confidence",
    reason: "Score at boundary",
    stepId: "1",
    confidenceScore: 60,
  };

  const result = await service.shouldAmend(trigger);
  // With default threshold of 60, a score of 60 should NOT trigger
  assertEquals(result, false);
});

Deno.test("shouldAmend uses config threshold for boundary values", async () => {
  const config = createMockConfig("/tmp/test");
  config.amendment = {
    enabled: true,
    threshold: 90,
    expiryMs: 86_400_000,
    hitl_timeout_ms: 300_000,
    on_timeout: "abort",
  };
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
