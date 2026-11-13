/**
 * @module StaticOverlayPricingTest
 * @path packages/model-registry/tests/static_overlay_pricing_test.ts
 * @description Verifies that the Solo price overlay records real verification dates and prices every cloud provider default model or lists it as unpriced on purpose.
 * @architectural-layer Registry
 * @dependencies [@std/assert, @exaix/ai-anthropic, @exaix/ai-openai, @exaix/ai-google, @exaix/ai-openrouter]
 * @related-files [packages/model-registry/src/static_overlay.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { DEFAULT_ANTHROPIC_MODEL } from "@exaix/ai-anthropic";
import { DEFAULT_OPENAI_MODEL } from "@exaix/ai-openai";
import { DEFAULT_GOOGLE_MODEL } from "@exaix/ai-google";
import { DEFAULT_OPENROUTER_MODEL } from "@exaix/ai-openrouter";
import { ProviderType } from "@exaix/core";
import { getOverlayEntry, STATIC_OVERLAY } from "../src/static_overlay.ts";

const PLACEHOLDER_VERIFIED_AT = 1_720_000_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default models of the cloud providers, by provider id. */
const CLOUD_DEFAULTS: Readonly<Record<string, string>> = {
  [ProviderType.ANTHROPIC]: DEFAULT_ANTHROPIC_MODEL,
  [ProviderType.OPENAI]: DEFAULT_OPENAI_MODEL,
  [ProviderType.GOOGLE]: DEFAULT_GOOGLE_MODEL,
  [ProviderType.OPENROUTER]: DEFAULT_OPENROUTER_MODEL,
};

/** Providers that carry no overlay price on purpose, because the aggregator reports the cost of each call. */
const UNPRICED_ON_PURPOSE: ReadonlySet<string> = new Set([ProviderType.OPENROUTER]);

Deno.test("fix(model-registry): no overlay entry keeps the shared placeholder verification date", () => {
  for (const [key, entry] of Object.entries(STATIC_OVERLAY)) {
    assertNotEquals(entry.verifiedAt, PLACEHOLDER_VERIFIED_AT, key);
  }
});

Deno.test("fix(model-registry): every overlay entry records a whole UTC day that is not in the future", () => {
  for (const [key, entry] of Object.entries(STATIC_OVERLAY)) {
    assertEquals(entry.verifiedAt % MS_PER_DAY, 0, `${key} verifiedAt is not a whole UTC day`);
    assertEquals(entry.verifiedAt <= Date.now(), true, `${key} verifiedAt is in the future`);
  }
});

Deno.test("fix(model-registry): every cloud provider default model has an overlay price or is unpriced on purpose", () => {
  const missing = Object.entries(CLOUD_DEFAULTS)
    .filter(([provider]) => !UNPRICED_ON_PURPOSE.has(provider))
    .filter(([provider, model]) => getOverlayEntry(provider, model)?.inputPerMtok === undefined)
    .map(([provider, model]) => `${provider}:${model}`);
  assertEquals(missing, []);
});
