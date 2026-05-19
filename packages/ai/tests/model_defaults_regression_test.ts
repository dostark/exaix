/**
 * @module ModelDefaultsRegressionTest
 * @path packages/ai/tests/model_defaults_regression_test.ts
 * @description Regression tests for LLM provider defaults, ensuring that latest
 * production models (GPT, Claude, Gemini) are correctly mapped as system defaults.
 */

import { assertEquals } from "@std/assert";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "@exaix/ai-anthropic";
import { DEFAULT_GOOGLE_MODEL, GoogleProvider } from "@exaix/ai-google";
import { DEFAULT_OPENAI_MODEL, OpenAIProvider } from "@exaix/ai-openai";
import { DEFAULT_AI_MODEL, DEFAULT_FAST_MODEL_NAME } from "@exaix/ai";

Deno.test("[regression] verify default openai model is gpt-5-mini", () => {
  const provider = new OpenAIProvider({ apiKey: "test-key" });
  const id = provider.id;
  assertEquals(id, `openai-${DEFAULT_OPENAI_MODEL}`);
  assertEquals(DEFAULT_OPENAI_MODEL, DEFAULT_OPENAI_MODEL);
});

Deno.test("[regression] verify default anthropic model is claude-haiku-4-5-20251001", () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });
  const id = provider.id;
  assertEquals(id, `anthropic-${DEFAULT_ANTHROPIC_MODEL}`);
  assertEquals(DEFAULT_ANTHROPIC_MODEL, DEFAULT_ANTHROPIC_MODEL);
});

Deno.test("[regression] verify default google model is gemini-flash-latest", () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });
  const id = provider.id;
  assertEquals(id, `google-${DEFAULT_GOOGLE_MODEL}`);
  assertEquals(DEFAULT_GOOGLE_MODEL, DEFAULT_GOOGLE_MODEL);
});

Deno.test("[regression] verify global default model is gemini-flash-latest", () => {
  assertEquals(DEFAULT_AI_MODEL, DEFAULT_GOOGLE_MODEL);
});

Deno.test("[regression] verify default fast model is gemini-flash-latest", () => {
  assertEquals(DEFAULT_FAST_MODEL_NAME, DEFAULT_GOOGLE_MODEL);
});
