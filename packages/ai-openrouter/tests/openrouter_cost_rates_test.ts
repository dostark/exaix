/**
 * @module OpenRouterCostRatesTest
 * @path packages/ai-openrouter/tests/openrouter_cost_rates_test.ts
 * @related-files ["packages/ai-openrouter/src/constants.ts", "packages/core/src/types/constants.ts"]
 * @architectural-layer AI
 * @description Pins the two OpenRouter cost constants and their different jobs. The provider metadata value
 * is a nonzero ranking estimate that provider selection reads. The cost tracker rate is a zero sentinel that
 * means "use the reported cost". Merging them would rank OpenRouter as free.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { COST_RATE_OPENROUTER } from "@exaix/core";
import { OPENROUTER_COST_PER_MTok, OPENROUTER_PROVIDER_METADATA } from "@exaix/ai-openrouter";

Deno.test("the provider metadata keeps a nonzero ranking estimate for provider selection", () => {
  assertEquals(OPENROUTER_PROVIDER_METADATA.costPerMtok, OPENROUTER_COST_PER_MTok);
  assert(OPENROUTER_COST_PER_MTok > 0, "a zero estimate would rank OpenRouter as the cheapest provider");
});

Deno.test("the cost tracker rate is the zero sentinel and is not the ranking estimate", () => {
  assertEquals(COST_RATE_OPENROUTER, 0);
  assertNotEquals(COST_RATE_OPENROUTER, OPENROUTER_COST_PER_MTok);
});
