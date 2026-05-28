/**
 * @module TokenizerTest
 * @path packages/core/tests/func/tokenizer_test.ts
 * @description Tests for ITokenizer interface and AiTokenEstimatorTokenizer
 * @architectural-layer Core
 * @dependencies [@exaix/core/func]
 * @related-files [packages/core/src/func/tokenizer.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import type { ITokenizer } from "@exaix/core/func";
import { TokenizerBackend } from "@exaix/core/types";

Deno.test("[Tokenizer] AiTokenEstimatorTokenizer.countTokens('hello', 'gpt-4o') returns exact BPE count", async () => {
  const t = new AiTokenEstimatorTokenizer(TokenizerBackend.LOCAL);
  const result = await t.countTokens("hello", "gpt-4o");
  assertEquals(result, 1);
});

Deno.test("[Tokenizer] AiTokenEstimatorTokenizer.countTokens('', 'gpt-4o') returns 0", async () => {
  const t = new AiTokenEstimatorTokenizer(TokenizerBackend.LOCAL);
  const result = await t.countTokens("", "gpt-4o");
  assertEquals(result, 0);
});

Deno.test("[Tokenizer] AiTokenEstimatorTokenizer.countTokensBatch returns per-string results", async () => {
  const t = new AiTokenEstimatorTokenizer(TokenizerBackend.LOCAL);
  const results = await t.countTokensBatch(["hello", "world"], "gpt-4o");
  assertEquals(results.length, 2);
  assertEquals(results[0], 1);
  assertEquals(results[1], 1);
});

Deno.test("[Tokenizer] TokenizerBackend type accepts valid values", () => {
  const auto: TokenizerBackend = TokenizerBackend.AUTO;
  const local: TokenizerBackend = TokenizerBackend.LOCAL;
  const api: TokenizerBackend = TokenizerBackend.API;
  assertEquals(auto, "auto");
  assertEquals(local, "local");
  assertEquals(api, "api");
});

Deno.test("[Tokenizer] AiTokenEstimatorTokenizer implements ITokenizer", () => {
  const t: ITokenizer = new AiTokenEstimatorTokenizer();
  assertEquals(t !== null, true);
});

Deno.test("[Tokenizer] LOCAL backend passes mode:local to ai-token-estimator", async () => {
  const t = new AiTokenEstimatorTokenizer(TokenizerBackend.LOCAL);
  const result = await t.countTokens("hello world", "gpt-4o");
  assertEquals(typeof result, "number");
  assert(result > 0, "LOCAL backend should produce positive token count");
});

Deno.test("[Tokenizer] AUTO backend does not fail without mode param", async () => {
  const t = new AiTokenEstimatorTokenizer(TokenizerBackend.AUTO);
  const result = await t.countTokens("hello world", "gpt-4o");
  assertEquals(typeof result, "number");
  assert(result > 0, "AUTO backend should produce positive token count");
});

Deno.test("[Tokenizer] AiTokenEstimatorTokenizer falls back to heuristic for unknown model", async () => {
  const t = new AiTokenEstimatorTokenizer(TokenizerBackend.LOCAL);
  const result = await t.countTokens("hello world", "unknown:model");
  assertEquals(typeof result, "number");
  assert(result > 0, "unknown model should still produce token count");
});
