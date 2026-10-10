/**
 * @module EffortTierOrderTest
 * @path packages/ai/tests/effort_tier_order_test.ts
 * @description The effort ranking the resolver uses covers every level, so the highest tiers rank above high.
 * @architectural-layer Test
 * @related-files ["packages/ai/src/effort_resolver.ts"]
 */

import { assertEquals } from "@std/assert";
import { EFFORT_TIER_ORDER } from "../src/effort_resolver.ts";

Deno.test("EFFORT_TIER_ORDER ranks xhigh above high and max above xhigh", () => {
  assertEquals([...EFFORT_TIER_ORDER], ["low", "medium", "high", "xhigh", "max"]);
});
