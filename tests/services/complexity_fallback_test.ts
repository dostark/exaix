/**
 * @module ComplexityFallbackTest
 * @path tests/complexity_fallback_test.ts
 * @description Verifies the model selection logic based on task complexity, ensuring
 * that the system falls back to more capable models for non-trivial requests.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { calculateComplexityFromText } from "../scripts/measure_complexity.ts";

Deno.test("[heuristic] simple complexity counts", () => {
  const src = `function f(x) { if (x) { return 1 } else { return 2 } }`;
  const c = calculateComplexityFromText(src);
  // base 1 + if + else = 3
  assertEquals(c >= 3, true);
});

Deno.test("[heuristic] logical and ternary", () => {
  const src = `const a = cond1 && cond2 ? 1 : 2;`;
  const c = calculateComplexityFromText(src);
  // base 1 + && + ? = at least 3
  assertEquals(c >= 3, true);
});
