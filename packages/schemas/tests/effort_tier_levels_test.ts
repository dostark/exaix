/**
 * @module EffortTierLevelsTest
 * @path packages/schemas/tests/effort_tier_levels_test.ts
 * @description The effort tier schema accepts every level the Anthropic docs list, in ascending order.
 * @architectural-layer Test
 * @related-files ["packages/schemas/src/model_intent.ts"]
 */

import { assertEquals } from "@std/assert";
import { EffortTierSchema } from "../src/model_intent.ts";

Deno.test("EffortTierSchema accepts every documented effort level, in ascending order", () => {
  assertEquals([...EffortTierSchema.options], ["low", "medium", "high", "xhigh", "max"]);
});
