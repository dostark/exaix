/**
 * @module ProviderRetryAfterConfigTest
 * @path tests/integration/provider_retry_after_config_test.ts
 * @description Every BaseProvider subclass resolves its Retry-After cap from ai_retry.retry_after_max_ms, and an
 *   explicit option wins over the config value.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/ai-anthropic, @exaix/ai-google, @exaix/ai-openai, @exaix/ai-openrouter]
 * @related-files [packages/ai/src/providers/base_provider.ts, packages/schemas/src/config.ts]
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_AI_RETRY_AFTER_MAX_MS } from "@exaix/core";
import type { Config } from "@exaix/schemas";
import { createMockConfig, withEnv } from "@exaix/testing";
import type { ProviderType } from "@exaix/core";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { BaseProvider } from "@exaix/ai/providers";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import { AnthropicProvider, AnthropicProviderFactory } from "@exaix/ai-anthropic";
import { GoogleProvider, GoogleProviderFactory } from "@exaix/ai-google";
import { OpenAIProvider, OpenAIProviderFactory } from "@exaix/ai-openai";
import { OpenRouterProvider, OpenRouterProviderFactory } from "@exaix/ai-openrouter";

const CONFIGURED_CAP_MS = 2_500;
const EXPLICIT_CAP_MS = 4_000;
const BACKOFF_BASE_MS = 100;
const FACTORY_TIMEOUT_MS = 30_000;

/** The cap that a provider resolved, read through its public field. */
function capOf(provider: IModelProvider): number {
  if (!(provider instanceof BaseProvider)) throw new Error("expected a BaseProvider subclass");
  return provider.retryAfterMaxMs;
}

type ProviderBuilder = (config: Config, retryAfterMaxMs?: number) => IModelProvider;

const BUILDERS: Record<string, ProviderBuilder> = {
  openrouter: (config, retryAfterMaxMs) =>
    new OpenRouterProvider({ apiKey: "sk-test", model: "openai/gpt-4", config, retryAfterMaxMs }),
  anthropic: (config, retryAfterMaxMs) => new AnthropicProvider({ apiKey: "sk-test", config, retryAfterMaxMs }),
  google: (config, retryAfterMaxMs) => new GoogleProvider({ apiKey: "sk-test", config, retryAfterMaxMs }),
  openai: (config, retryAfterMaxMs) => new OpenAIProvider({ apiKey: "sk-test", config, retryAfterMaxMs }),
};

function configWithCap(retryAfterMaxMs?: number): Config {
  return createMockConfig("/tmp/retry-after-config", {
    ai_retry: {
      max_attempts: 3,
      backoff_base_ms: BACKOFF_BASE_MS,
      timeout_per_request_ms: 30_000,
      ...(retryAfterMaxMs !== undefined ? { retry_after_max_ms: retryAfterMaxMs } : {}),
    },
  } as Partial<Config>);
}

for (const [name, build] of Object.entries(BUILDERS)) {
  Deno.test(`[retry] ${name} resolves its Retry-After cap from config, option and default`, () => {
    const fromConfig = build(configWithCap(CONFIGURED_CAP_MS));
    assertEquals(capOf(fromConfig), CONFIGURED_CAP_MS);

    const explicit = build(configWithCap(CONFIGURED_CAP_MS), EXPLICIT_CAP_MS);
    assertEquals(capOf(explicit), EXPLICIT_CAP_MS);

    const fallback = build(configWithCap());
    assertEquals(capOf(fallback), DEFAULT_AI_RETRY_AFTER_MAX_MS);
  });
}

const FACTORIES: Record<string, { factory: IProviderFactory; provider: string; model: string; keyEnv: string }> = {
  openrouter: {
    factory: new OpenRouterProviderFactory(),
    provider: "openrouter",
    model: "openai/gpt-4",
    keyEnv: "OPENROUTER_API_KEY",
  },
  anthropic: {
    factory: new AnthropicProviderFactory(),
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    keyEnv: "ANTHROPIC_API_KEY",
  },
  google: {
    factory: new GoogleProviderFactory(),
    provider: "google",
    model: "gemini-2.5-pro",
    keyEnv: "GOOGLE_API_KEY",
  },
  openai: { factory: new OpenAIProviderFactory(), provider: "openai", model: "gpt-5", keyEnv: "OPENAI_API_KEY" },
};

for (const [name, { factory, provider, model, keyEnv }] of Object.entries(FACTORIES)) {
  Deno.test(`[retry] the ${name} factory passes the configured Retry-After cap to its provider`, async () => {
    await withEnv({ [keyEnv]: "sk-test" }, async () => {
      const created = await factory.create({
        provider: provider as ProviderType,
        model,
        timeoutMs: FACTORY_TIMEOUT_MS,
        config: configWithCap(CONFIGURED_CAP_MS),
      });
      assertEquals(capOf(created), CONFIGURED_CAP_MS);
    });
  });
}
