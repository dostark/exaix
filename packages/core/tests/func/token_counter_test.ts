/**
 * @module TokenCounterTest
 * @path packages/core/tests/func/token_counter_test.ts
 * @description Tests for TokenCounter utility.
 */

import { assertEquals, assertGreater, assertLess } from "@std/assert";
import { TokenCounter } from "@exaix/core/func";
import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";

Deno.test("[TokenCounter] estimates tokens using 4:1 heuristic", () => {
  const counter = new TokenCounter();
  const text = "x".repeat(400);
  const estimatedTokens = counter.countTokens(text);
  assertEquals(estimatedTokens, 100);
});

Deno.test("[TokenCounter] estimates tokens accurately for various lengths", () => {
  const counter = new TokenCounter();
  const shortText = "Hello";
  const shortTokens = counter.countTokens(shortText);
  assertGreater(shortTokens, 0);
  assertLess(shortTokens, 5);

  const longText = "x".repeat(4000);
  const longTokens = counter.countTokens(longText);
  assertEquals(longTokens, 1000);
});

Deno.test("[TokenCounter] counts empty string as 0 tokens", () => {
  const counter = new TokenCounter();
  const tokens = counter.countTokens("");
  assertEquals(tokens, 0);
});

Deno.test("[TokenCounter] includes whitespace in token count", () => {
  const counter = new TokenCounter();
  const textWithSpaces = "x x x x x";
  const textWithoutSpaces = "xxxxx";
  const tokensWith = counter.countTokens(textWithSpaces);
  const tokensWithout = counter.countTokens(textWithoutSpaces);
  assertEquals(tokensWith, Math.ceil(9 / TOKEN_ESTIMATION_CHARS_PER_TOKEN));
  assertEquals(tokensWithout, Math.ceil(5 / TOKEN_ESTIMATION_CHARS_PER_TOKEN));
  assertGreater(tokensWith, tokensWithout);
});

Deno.test("[TokenCounter] uses TOKEN_ESTIMATION_CHARS_PER_TOKEN constant", () => {
  const counter = new TokenCounter();
  const text = "x".repeat(TOKEN_ESTIMATION_CHARS_PER_TOKEN * 10);
  const tokens = counter.countTokens(text);
  assertEquals(tokens, 10);
});
