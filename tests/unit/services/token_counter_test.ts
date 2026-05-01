/**
 * @module TokenCounterTest
 * @path tests/unit/services/token_counter_test.ts
 * @description Tests for Phase 62 Step 62.2 TokenCounter service.
 * @architectural-layer Test
 * @related-files [src/services/context/token_counter.ts, "packages/core/src/types/constants.ts"]
 */

import { assertEquals, assertGreater, assertLess } from "@std/assert";
import { TokenCounter } from "../../../src/services/context/token_counter.ts";
import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";

// ============================================================================
// Test 1: Heuristic token counting uses 4:1 char ratio
// ============================================================================

Deno.test("[TokenCounter] estimates tokens using 4:1 heuristic", () => {
  const counter = new TokenCounter();
  const text = "x".repeat(400); // 400 chars

  const estimatedTokens = counter.countTokens(text);

  // Should be approximately 400 / 4 = 100 tokens
  assertEquals(estimatedTokens, 100);
});

// ============================================================================
// Test 2: Token estimation is accurate for varied text lengths
// ============================================================================

Deno.test("[TokenCounter] estimates tokens accurately for various lengths", () => {
  const counter = new TokenCounter();

  const shortText = "Hello";
  const shortTokens = counter.countTokens(shortText);
  assertGreater(shortTokens, 0); // At least 1 token
  assertLess(shortTokens, 5); // Not more than 5

  const longText = "x".repeat(4000);
  const longTokens = counter.countTokens(longText);
  assertEquals(longTokens, 1000); // 4000 / 4 = 1000
});

// ============================================================================
// Test 3: Empty string counts as 0 tokens
// ============================================================================

Deno.test("[TokenCounter] counts empty string as 0 tokens", () => {
  const counter = new TokenCounter();
  const tokens = counter.countTokens("");

  assertEquals(tokens, 0);
});

// ============================================================================
// Test 4: Whitespace is counted in token estimation
// ============================================================================

Deno.test("[TokenCounter] includes whitespace in token count", () => {
  const counter = new TokenCounter();
  const textWithSpaces = "x x x x x"; // 9 chars
  const textWithoutSpaces = "xxxxx"; // 5 chars

  const tokensWith = counter.countTokens(textWithSpaces);
  const tokensWithout = counter.countTokens(textWithoutSpaces);

  assertEquals(tokensWith, Math.ceil(9 / TOKEN_ESTIMATION_CHARS_PER_TOKEN));
  assertEquals(tokensWithout, Math.ceil(5 / TOKEN_ESTIMATION_CHARS_PER_TOKEN));

  assertGreater(tokensWith, tokensWithout);
});

// ============================================================================
// Test 5: TokenCounter uses the 4:1 heuristic constant
// ============================================================================

Deno.test("[TokenCounter] uses TOKEN_ESTIMATION_CHARS_PER_TOKEN constant", () => {
  const counter = new TokenCounter();
  const text = "x".repeat(TOKEN_ESTIMATION_CHARS_PER_TOKEN * 10);

  const tokens = counter.countTokens(text);

  assertEquals(tokens, 10);
});
