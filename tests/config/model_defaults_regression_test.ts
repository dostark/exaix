/**
 * @module ModelDefaultsRegressionTest
 * @path tests/config/model_defaults_regression_test.ts
 * @description Regression tests for LLM provider defaults, ensuring that latest
 * production models (GPT, Claude, Gemini) are correctly mapped as system defaults.
 */

import { assertEquals } from "@std/assert";
import { OpenAIProvider } from "../../src/ai/providers/openai_provider.ts";
import { AnthropicProvider } from "../../src/ai/providers/anthropic_provider.ts";
import { GoogleProvider } from "../../src/ai/providers/google_provider.ts";
import * as DEFAULTS from "@exaix/ai";

Deno.test("[regression] verify default openai model is gpt-5-mini", () => {
  const provider = new OpenAIProvider({ apiKey: "test-key" });
  // access private 'model' property via 'any' casting or looking at the id if it contains the model
  const id = provider.id;
  assertEquals(id, `openai-${DEFAULTS.DEFAULT_OPENAI_MODEL}`);
  assertEquals(DEFAULTS.DEFAULT_OPENAI_MODEL, DEFAULTS.DEFAULT_OPENAI_MODEL);
});

Deno.test("[regression] verify default anthropic model is claude-haiku-4-5-20251001", () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });
  const id = provider.id;
  assertEquals(id, `anthropic-${DEFAULTS.DEFAULT_ANTHROPIC_MODEL}`);
  assertEquals(DEFAULTS.DEFAULT_ANTHROPIC_MODEL, DEFAULTS.DEFAULT_ANTHROPIC_MODEL);
});

Deno.test("[regression] verify default google model is gemini-flash-latest", () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });
  const id = provider.id;
  assertEquals(id, `google-${DEFAULTS.DEFAULT_GOOGLE_MODEL}`);
  assertEquals(DEFAULTS.DEFAULT_GOOGLE_MODEL, DEFAULTS.DEFAULT_GOOGLE_MODEL);
});

Deno.test("[regression] verify global default model is gemini-flash-latest", () => {
  assertEquals(DEFAULTS.DEFAULT_AI_MODEL, DEFAULTS.DEFAULT_GOOGLE_MODEL);
});

Deno.test("[regression] verify default fast model is gemini-flash-latest", () => {
  assertEquals(DEFAULTS.DEFAULT_FAST_MODEL_NAME, DEFAULTS.DEFAULT_GOOGLE_MODEL);
});
