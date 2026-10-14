/**
 * @module ProviderModelInfoTest
 * @path packages/ai/tests/provider_model_info_test.ts
 * @description Tests catalog reads and provider fallback without mutating registry metadata.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @exaix/core, @std/assert]
 * @related-files [packages/ai/src/provider_model_info.ts]
 */
import { assertEquals } from "@std/assert";
import { type IProviderMetadata, readProviderModelInfo, resolveProviderMetadata } from "@exaix/ai";
import { PricingTier, ProviderCostTier } from "@exaix/core";

const METADATA: IProviderMetadata = {
  name: "catalog-fixture",
  description: "Catalog fixture",
  capabilities: ["chat"],
  costTier: ProviderCostTier.PAID,
  pricingTier: PricingTier.MEDIUM,
  strengths: [],
  costPerMtok: 3,
  contextWindow: 1024,
  supportsThinking: true,
  supportsEffort: true,
};

Deno.test("model metadata reads return undefined when absent or rejected", async () => {
  assertEquals(await readProviderModelInfo(undefined, "model"), undefined);
  assertEquals(await readProviderModelInfo(METADATA, "model"), undefined);
  assertEquals(
    await readProviderModelInfo({ ...METADATA, modelInfo: () => Promise.reject(new Error("offline")) }, "model"),
    undefined,
  );
});

Deno.test("resolved model metadata preserves zero and false catalog values without mutating the provider", async () => {
  const models: string[] = [];
  const source = {
    ...METADATA,
    modelInfo: (model: string) => {
      models.push(model);
      return Promise.resolve({ inputPerMtok: 0, contextWindow: 0, supportsThinking: false, supportsEffort: false });
    },
  };
  const result = await resolveProviderMetadata(source, "selected-model");
  assertEquals([result.costPerMtok, result.contextWindow, result.supportsThinking, result.supportsEffort], [
    0,
    0,
    false,
    false,
  ]);
  assertEquals(models, ["selected-model"]);
  assertEquals([source.costPerMtok, source.contextWindow, source.supportsThinking, source.supportsEffort], [
    3,
    1024,
    true,
    true,
  ]);
});

Deno.test("resolved model metadata keeps provider fallbacks for missing catalog fields", async () => {
  const result = await resolveProviderMetadata({ ...METADATA, modelInfo: () => Promise.resolve({}) }, "model");
  assertEquals([result.costPerMtok, result.contextWindow, result.supportsThinking, result.supportsEffort], [
    3,
    1024,
    true,
    true,
  ]);
});
