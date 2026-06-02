/**
 * @module OpenRouterFactoryConfigTest
 * @path packages/ai-openrouter/tests/openrouter_factory_config_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_factory.ts", "packages/ai/src/provider_factory.ts", "packages/schemas/src/config.ts"]
 * @architectural-layer AI
 * @description Phase 80 follow-up — verifies the OpenRouterProviderFactory honours
 * config.ai_openrouter overrides (site_name, site_url, api_key_env) threaded through
 * IResolvedProviderOptions.config.
 */

import { assert, assertEquals } from "@std/assert";
import { ExaPathDefaults, LogLevel, ProviderType } from "@exaix/core";
import { type Config, ConfigSchema } from "@exaix/schemas";
import { OpenRouterProvider, OpenRouterProviderFactory } from "@exaix/ai-openrouter";

interface IConfigOverrides {
  ai_openrouter?: { api_key_env?: string; site_name?: string; site_url?: string };
}

function makeConfig(overrides: IConfigOverrides): Config {
  const result = ConfigSchema.safeParse({
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
    ...overrides,
  });
  if (!result.success) {
    throw new Error(`bad test config: ${result.error}`);
  }
  return result.data;
}

const OPENAI_RESPONSE = JSON.stringify({
  choices: [{ message: { content: "ok" } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

Deno.test("OpenRouterProviderFactory applies config site_name/site_url to ranking headers", async () => {
  let headers = new Headers();
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;

  try {
    const config = makeConfig({
      ai_openrouter: { site_name: "MyApp", site_url: "https://my.app", api_key_env: "OPENROUTER_API_KEY" },
    });
    const factory = new OpenRouterProviderFactory();
    const provider = await factory.create({
      provider: ProviderType.OPENROUTER,
      model: "openai/gpt-4",
      apiKey: "sk-test",
      timeoutMs: 60_000,
      config,
    });
    await provider.generate("hi");
    assertEquals(headers.get("X-Title"), "MyApp");
    assertEquals(headers.get("HTTP-Referer"), "https://my.app");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("OpenRouterProviderFactory reads api_key_env from config", async () => {
  Deno.env.delete("OPENROUTER_API_KEY");
  Deno.env.set("CUSTOM_OR_KEY", "sk-zzz");
  try {
    const config = makeConfig({
      ai_openrouter: { api_key_env: "CUSTOM_OR_KEY", site_name: "Exaix", site_url: "https://exaix.dev" },
    });
    const factory = new OpenRouterProviderFactory();
    const provider = await factory.create({
      provider: ProviderType.OPENROUTER,
      model: "openai/gpt-4",
      timeoutMs: 60_000,
      config,
    });
    assert(provider instanceof OpenRouterProvider);
  } finally {
    Deno.env.delete("CUSTOM_OR_KEY");
  }
});
