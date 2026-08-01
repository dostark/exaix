/**
 * @module StrictWiringTest
 * @path packages/ai/tests/providers/strict_wiring_test.ts
 * @description Phase 157 Step 2 — `[ai.mock] strict = true` must reach `MockLLMProvider` as
 *   `strictRecordings`, through `MockConfigSchema` → `IResolvedProviderOptions.mockStrict` →
 *   `MockProviderFactory.create`. Unset must stay false (today's default behaviour).
 * @architectural-layer AI
 * @related-files [packages/schemas/src/ai_config.ts, packages/ai/src/provider_factory.ts, packages/ai/src/factories/mock_factory.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { MockStrategy, ProviderType } from "@exaix/core";
import { ProviderFactory } from "../../src/provider_factory.ts";
import { MockLLMError, type MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";
import { createTestConfig } from "../helpers/test_config.ts";

Deno.test("[strict_wiring] mock.strict: true reaches MockLLMProvider as strictRecordings", async () => {
  const config = createTestConfig({
    provider: ProviderType.MOCK,
    mock: { strategy: MockStrategy.RECORDED, strict: true },
  });
  config.rate_limiting.enabled = false;

  const provider = await ProviderFactory.create(config) as MockLLMProvider;

  // No recordings configured and strict mode enabled: a miss must be fatal, naming the
  // call site is out of scope here (no callSite in options) — the whole-prompt-hash miss
  // error path is what proves strictRecordings actually reached the provider.
  await assertRejects(
    async () => await provider.generate("no recording will ever match this prompt"),
    MockLLMError,
    "strict recordings are enabled",
  );
});

Deno.test("[strict_wiring] mock.strict unset stays false — falls back to patterns as before", async () => {
  const config = createTestConfig({ provider: ProviderType.MOCK, mock: { strategy: MockStrategy.RECORDED } });
  config.rate_limiting.enabled = false;

  const provider = await ProviderFactory.create(config) as MockLLMProvider;

  const result = await provider.generate("Implement a feature");
  assertEquals(typeof result.content, "string");
});
