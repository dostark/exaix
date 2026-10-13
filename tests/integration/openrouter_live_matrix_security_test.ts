/**
 * @module OpenRouterLiveMatrixSecurityTest
 * @path tests/integration/openrouter_live_matrix_security_test.ts
 * @description Verifies paid opt-in and provider credential isolation for the live matrix.
 * @architectural-layer Integration
 * @dependencies [@exaix/testing]
 * @related-files [tests/integration/helpers/openrouter_live_matrix.ts]
 */
import { assertThrows } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { assertMatrixEnvironment } from "./helpers/openrouter_live_matrix.ts";

const MATRIX_TEST_ENV: Record<string, string | null> = {
  EXA_TEST_ENABLE_PAID_LLM: "1",
  OPENROUTER_API_KEY: "fixture-key-for-guard-only",
  OPENAI_API_KEY: null,
  ANTHROPIC_API_KEY: null,
  GOOGLE_API_KEY: null,
  DEEPSEEK_API_KEY: null,
};

Deno.test("[security] the OpenRouter matrix refuses a missing paid opt-in", async () => {
  await withEnv({ ...MATRIX_TEST_ENV, EXA_TEST_ENABLE_PAID_LLM: null }, () => {
    assertThrows(assertMatrixEnvironment, Error, "requires the paid opt-in and key");
    return Promise.resolve();
  });
});

Deno.test("[security] the OpenRouter matrix refuses other ambient provider credentials", async () => {
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY"]) {
    await withEnv({ ...MATRIX_TEST_ENV, [key]: "fixture-credential" }, () => {
      assertThrows(assertMatrixEnvironment, Error, "unset the other provider keys");
      return Promise.resolve();
    });
  }
  await withEnv(MATRIX_TEST_ENV, () => {
    assertMatrixEnvironment();
    return Promise.resolve();
  });
});
