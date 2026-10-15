/**
 * @module ProviderBillingErrorsTest
 * @path tests/integration/provider_billing_errors_test.ts
 * @description Verifies shared billing classification and one HTTP attempt through each concrete provider path.
 * @architectural-layer Test
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai/src/providers/common.ts]
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import { GoogleProvider } from "@exaix/ai-google";
import { OpenAIProvider } from "@exaix/ai-openai";
import { OpenRouterProvider } from "@exaix/ai-openrouter";
import { BillingError, type IBaseProviderOptions, isRetryable } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";

const BILLING_SENTINEL = "remote-billing-detail";
const BILLING_OPTIONS: IBaseProviderOptions = {
  apiKey: "fixture-key",
  model: "fixture-model",
  maxRetries: 3,
  retryDelayMs: 1,
};

interface IBillingProviderCase {
  name: string;
  build: () => IModelProvider;
  statusOnly: boolean;
}

const BILLING_PROVIDERS: IBillingProviderCase[] = [
  { name: "Anthropic", build: () => new AnthropicProvider(BILLING_OPTIONS), statusOnly: false },
  { name: "Google", build: () => new GoogleProvider(BILLING_OPTIONS), statusOnly: false },
  { name: "OpenAI", build: () => new OpenAIProvider(BILLING_OPTIONS), statusOnly: false },
  { name: "OpenRouter", build: () => new OpenRouterProvider(BILLING_OPTIONS), statusOnly: false },
  ...(["openai", "deepseek"] as const).map((profile): IBillingProviderCase => ({
    name: profile === "openai" ? "openai-chat" : "DeepSeek",
    build: () =>
      new OpenAIProvider({
        ...BILLING_OPTIONS,
        compatible: {
          profile,
          endpoint: "https://fixture.example/v1/chat/completions",
          allow_insecure_loopback: false,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      }),
    statusOnly: true,
  })),
];

Deno.test("a 402 body maps to BillingError for Anthropic, Google, OpenAI, OpenRouter, openai-chat and DeepSeek; a 402 is fetched once", async (t) => {
  for (const testCase of BILLING_PROVIDERS) {
    await t.step(testCase.name, async () => {
      let fetchCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(
          new Response(JSON.stringify({ error: { type: "api_error", message: BILLING_SENTINEL } }), { status: 402 }),
        );
      }) as typeof globalThis.fetch;
      try {
        const provider = testCase.build();
        const error = await assertRejects(() => provider.generate("fixture prompt"), BillingError);
        assertEquals(error.provider, provider.id);
        assertEquals(isRetryable(error), false);
        assertEquals(fetchCalls, 1, "billing failures must not spend the retry budget");
        if (testCase.statusOnly) assertEquals(error.message, "HTTP 402");
        else assert(error.message.includes(BILLING_SENTINEL));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});
