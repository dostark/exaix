/**
 * @module MockStrictEnvTest
 * @path packages/ai/tests/providers/mock_strict_env_test.ts
 * @description Phase 157 Step 3 — MOCK_STRICT=1 enables strictRecordings even when
 *   `[ai.mock] strict` is unset in config, so a scenario pack can scope strict mode per step
 *   via env: (the sandbox's one shared exa.config.toml can't express per-pack strictness).
 *   Unset MOCK_STRICT falls back to the config value exactly as before (Step 2's wiring).
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_factory.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { MockStrategy, ProviderType } from "@exaix/core";
import { withEnv } from "@exaix/testing";
import { ProviderFactory } from "../../src/provider_factory.ts";
import { MockLLMError, type MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";
import { createTestConfig } from "../helpers/test_config.ts";

Deno.test("[mock_strict_env] MOCK_STRICT=1 enables strictRecordings even when config.mock.strict is unset", async () => {
  await withEnv({ MOCK_STRICT: "1" }, async () => {
    const config = createTestConfig({ provider: ProviderType.MOCK, mock: { strategy: MockStrategy.RECORDED } });
    config.rate_limiting.enabled = false;

    const provider = await ProviderFactory.create(config) as MockLLMProvider;

    await assertRejects(
      async () => await provider.generate("no recording will ever match this prompt"),
      MockLLMError,
      "strict recordings are enabled",
    );
  });
});

Deno.test("[mock_strict_env] MOCK_STRICT unset falls back to the config value", async () => {
  await withEnv({ MOCK_STRICT: null }, async () => {
    const config = createTestConfig({ provider: ProviderType.MOCK, mock: { strategy: MockStrategy.RECORDED } });
    config.rate_limiting.enabled = false;

    const provider = await ProviderFactory.create(config) as MockLLMProvider;

    const result = await provider.generate("Implement a feature");
    assertEquals(typeof result.content, "string");
  });
});

Deno.test("[mock_strict_env] MOCK_STRICT=0 does not enable strict mode", async () => {
  await withEnv({ MOCK_STRICT: "0" }, async () => {
    const config = createTestConfig({ provider: ProviderType.MOCK, mock: { strategy: MockStrategy.RECORDED } });
    config.rate_limiting.enabled = false;

    const provider = await ProviderFactory.create(config) as MockLLMProvider;

    const result = await provider.generate("Implement a feature");
    assertEquals(typeof result.content, "string");
  });
});
