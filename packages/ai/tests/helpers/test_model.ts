/**
 * @module AIProviderTestModel
 * @path tests/ai/helpers/test_model.ts
 * @description Provides a strongly-typed mock model identifier for provider tests,
 * ensuring consistent identification across varied LLM backends.
 */

export function getTestModel(): string {
  return Deno.env.get("EXA_TEST_LLM_MODEL") ?? "gpt-5-mini";
}

export function getTestModelDisplay(): string {
  // Upper-case for human-readable messages (e.g., GPT-5-MINI)
  return getTestModel().toUpperCase();
}
