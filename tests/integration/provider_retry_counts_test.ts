/**
 * @module ProviderRetryCountsTest
 * @path tests/integration/provider_retry_counts_test.ts
 * @description One retry loop per provider. A sustained 503 makes exactly maxRetries HTTP calls for each
 *   BaseProvider subclass, including the compatible branch. The compatible branch journals no retry event,
 *   because its contract is one terminal event.
 * @architectural-layer Test
 * @related-files [packages/ai/src/providers/base_provider.ts, packages/ai/src/provider_common_utils.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { GoogleProvider } from "@exaix/ai-google";
import { OpenAIProvider } from "@exaix/ai-openai";
import { OpenRouterProvider } from "@exaix/ai-openrouter";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1;
const COMPATIBLE_ENDPOINT = "http://127.0.0.1:4312/v1/chat/completions";

const PROVIDERS: Array<{ name: string; build: () => IModelProvider; expectedCalls: number }> = [
  {
    name: "openrouter",
    build: () =>
      new OpenRouterProvider({
        apiKey: "sk-test",
        model: "openai/gpt-4",
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
      }),
    expectedCalls: MAX_RETRIES,
  },
  {
    name: "anthropic",
    build: () =>
      new AnthropicProvider({
        apiKey: "sk-test",
        model: "claude-test",
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
      }),
    expectedCalls: MAX_RETRIES,
  },
  {
    name: "google",
    build: () =>
      new GoogleProvider({
        apiKey: "sk-test",
        model: "gemini-test",
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
      }),
    expectedCalls: MAX_RETRIES,
  },
  {
    name: "openai",
    build: () =>
      new OpenAIProvider({
        apiKey: "sk-test",
        model: "gpt-test",
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
      }),
    expectedCalls: MAX_RETRIES,
  },
  {
    name: "openai compatible",
    build: () =>
      new OpenAIProvider({
        apiKey: "test-key",
        model: "compat-fixture-v1",
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
        compatible: {
          profile: "local-test",
          endpoint: COMPATIBLE_ENDPOINT,
          allow_insecure_loopback: true,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      }),
    expectedCalls: MAX_RETRIES,
  },
];

for (const { name, build, expectedCalls } of PROVIDERS) {
  Deno.test(`[retry] a sustained 503 makes exactly ${expectedCalls} HTTP call(s) for ${name}`, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(new Response("{}", { status: 503 }));
    }) as typeof fetch;
    try {
      await assertRejects(() => build().generate("hi"));
      assertEquals(calls, expectedCalls);
    } finally {
      globalThis.fetch = original;
    }
  });
}

Deno.test("[retry] the compatible branch retries a 503 without a provider.retry.scheduled event", async () => {
  const original = globalThis.fetch;
  const logger = createMockEventLogger();
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 503 }))) as typeof fetch;
  try {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "compat-fixture-v1",
      maxRetries: MAX_RETRIES,
      retryDelayMs: RETRY_DELAY_MS,
      logger,
      compatible: {
        profile: "local-test",
        endpoint: COMPATIBLE_ENDPOINT,
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    await assertRejects(() => provider.generate("hi"));
    assertEquals(logger.events.filter((event) => event.action === DomainEventType.ProviderRetryScheduled), []);
  } finally {
    globalThis.fetch = original;
  }
});
