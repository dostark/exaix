/**
 * @module LiveProviderConstantsTest
 * @path packages/testing/tests/live_provider_constants_test.ts
 * @description Verifies live-provider model defaults remain compatible with CLI provider selection.
 * @architectural-layer Testing
 * @dependencies [@exaix/testing]
 * @related-files [packages/testing/src/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { ENV_TEST_LLM_MODEL, ENV_TEST_LLM_PROVIDER, getTestLlmModel, withEnv } from "@exaix/testing";

Deno.test("getTestLlmModel selects a compatible CLI model when only the provider is overridden", async () => {
  const expectedModels = {
    "claude-cli": "claude-sonnet-5",
    "codex-cli": "gpt-5.6-terra",
    "opencode-cli": "opencode/deepseek-v4-flash-free",
  };
  for (const [provider, model] of Object.entries(expectedModels)) {
    await withEnv(
      {
        [ENV_TEST_LLM_PROVIDER]: provider,
        [ENV_TEST_LLM_MODEL]: null,
      },
      () => assertEquals(getTestLlmModel(), model),
    );
  }
});
