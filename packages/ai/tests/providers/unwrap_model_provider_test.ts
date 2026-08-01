/**
 * @module UnwrapModelProviderTest
 * @path packages/ai/tests/providers/unwrap_model_provider_test.ts
 * @description Phase 157 Step 4 — unwrapModelProvider reaches through a TracedProvider /
 *   RateLimitedProvider decorator chain to the underlying provider, so daemon shutdown can
 *   find the real MockLLMProvider (if any) to report drift on, regardless of how many
 *   wrappers ProviderFactory applied.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/common.ts, packages/ai/src/traced_provider.ts, packages/ai/src/rate_limited_provider.ts]
 */

import { assertStrictEquals } from "@std/assert";
import { unwrapModelProvider } from "../../src/providers/common.ts";
import { TracedProvider } from "../../src/traced_provider.ts";
import { RateLimitedProvider } from "../../src/rate_limited_provider.ts";
import { MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";
import { MockStrategy } from "@exaix/core";
import { createMockLogger } from "@exaix/testing";

const noopLogger = createMockLogger();

Deno.test("[unwrap_model_provider] an unwrapped provider returns itself", () => {
  const mock = new MockLLMProvider(MockStrategy.SCRIPTED);
  assertStrictEquals(unwrapModelProvider(mock), mock);
});

Deno.test("[unwrap_model_provider] reaches through a single TracedProvider wrapper", () => {
  const mock = new MockLLMProvider(MockStrategy.SCRIPTED);
  const traced = new TracedProvider(mock, noopLogger);
  assertStrictEquals(unwrapModelProvider(traced), mock);
});

Deno.test("[unwrap_model_provider] reaches through a nested TracedProvider(RateLimitedProvider(...)) chain", () => {
  const mock = new MockLLMProvider(MockStrategy.SCRIPTED);
  const rateLimited = new RateLimitedProvider(mock, {
    maxCallsPerMinute: 10,
    maxTokensPerHour: 1000,
    maxCostPerDay: 10,
    costPer1kTokens: 0.01,
  });
  const traced = new TracedProvider(rateLimited, noopLogger);
  assertStrictEquals(unwrapModelProvider(traced), mock);
});
