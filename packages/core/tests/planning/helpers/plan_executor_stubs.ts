/**
 * @module PlanExecutorTestStubs
 * @path packages/core/tests/planning/helpers/plan_executor_stubs.ts
 * @description Provider, database, and registry stubs shared by the plan executor tests.
 * @architectural-layer Test
 * @related-files [packages/core/tests/planning/plan_executor_model_resolver_test.ts, packages/core/tests/planning/plan_executor_skill_floors_test.ts]
 */

import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";

export const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "STATUS: COMPLETE\nSUMMARY: done",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

export const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

export function registerLocalProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 128_000,
  });
}
