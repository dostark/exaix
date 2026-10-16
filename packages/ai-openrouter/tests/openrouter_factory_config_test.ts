/**
 * @module OpenRouterFactoryConfigTest
 * @path packages/ai-openrouter/tests/openrouter_factory_config_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_factory.ts", "packages/ai/src/provider_factory.ts", "packages/schemas/src/config.ts"]
 * @architectural-layer AI
 * @description Phase 80 follow-up — verifies the OpenRouterProviderFactory honours
 * config.ai_openrouter overrides (site_name, site_url, api_key_env) threaded through
 * IResolvedProviderOptions.config.
 */

import { ExaPathDefaults } from "@exaix/shared";
import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { LogLevel, ProviderType, SecureCredentialStore } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { createMockLogger, withEnv } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";
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
  globalThis.fetch = ((_input: string | URL | Request, init?: Opt<RequestInit, Reason.OptionalContext>) => {
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

const FACTORY_MODEL = "vendor/specific-model";
const FACTORY_CONTEXT_WINDOW = 262_144;
const FACTORY_MODELS_URL = "https://catalog.example/api/v1/models";
const MODEL_INFO_BOUND_MS = 5_000;
const LOOKUP_BACKOFF_PASSED_MS = 120_000;
const TEST_DEADLINE_TOLERANCE_MS = 1_000;
const FACTORY_CATALOG = {
  data: [
    {
      id: FACTORY_MODEL,
      context_length: FACTORY_CONTEXT_WINDOW,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "reasoning", "reasoning_effort"],
      reasoning: { supported_efforts: ["low", "high"] },
    },
    { id: "vendor/plain-model", supported_parameters: [] },
  ],
};

Deno.test("modelInfo maps the entry from the configured endpoint and returns undefined for an unknown model", async () => {
  const urls: string[] = [];
  using _fetchStub = stub(globalThis, "fetch", (input) => {
    urls.push(String(input));
    return Promise.resolve(Response.json(FACTORY_CATALOG));
  });
  const factory = new OpenRouterProviderFactory();
  await factory.create({
    provider: ProviderType.OPENROUTER,
    model: FACTORY_MODEL,
    apiKey: "sk-test",
    timeoutMs: 60_000,
    baseUrl: "https://catalog.example/api/v1/chat/completions",
  });
  assertEquals(await factory.modelInfo(FACTORY_MODEL), {
    contextWindow: FACTORY_CONTEXT_WINDOW,
    inputPerMtok: 3,
    outputPerMtok: 15,
    supportsThinking: true,
    supportsEffort: true,
  });
  assertEquals(await factory.modelInfo("vendor/plain-model"), { supportsThinking: false, supportsEffort: false });
  assertEquals(await factory.modelInfo("vendor/absent"), undefined);
  assertEquals(urls, [FACTORY_MODELS_URL]);
});

Deno.test("providers from one factory share one lookup with modelInfo, with separate caches per models URL", async () => {
  const urls: string[] = [];
  using _fetchStub = stub(globalThis, "fetch", (input) => {
    if (String(input).endsWith("/models")) {
      urls.push(String(input));
      return Promise.resolve(Response.json(FACTORY_CATALOG));
    }
    return Promise.resolve(new Response(OPENAI_RESPONSE));
  });
  const factory = new OpenRouterProviderFactory();
  const options = { provider: ProviderType.OPENROUTER, model: FACTORY_MODEL, apiKey: "sk-test", timeoutMs: 60_000 };
  const first = await factory.create({ ...options, baseUrl: "https://catalog.example/api/v1/chat/completions" });
  const second = await factory.create({ ...options, baseUrl: "https://catalog.example/api/v1/" });
  await Promise.all([
    first.generate("hi", { thinking: false }),
    second.generate("hi", { thinking: false }),
    factory.modelInfo(FACTORY_MODEL),
  ]);
  assertEquals(urls, [FACTORY_MODELS_URL]);
  await factory.create({ ...options, baseUrl: "https://other.example/api/v1" });
  await factory.modelInfo(FACTORY_MODEL);
  await factory.create({ ...options, baseUrl: "https://catalog.example/api/v1" });
  await factory.modelInfo(FACTORY_MODEL);
  assertEquals(urls, [FACTORY_MODELS_URL, "https://other.example/api/v1/models"]);
});

Deno.test("modelInfo with no key returns undefined without a request", async () => {
  using readStub = stub(SecureCredentialStore, "get", () => Promise.resolve(null));
  using _fetchStub = stub(globalThis, "fetch", () => {
    throw new Error("must not request without a key");
  });
  await withEnv({ OPENROUTER_API_KEY: null }, async () => {
    assertEquals(await new OpenRouterProviderFactory().modelInfo(FACTORY_MODEL), undefined);
  });
  assertEquals(readStub.calls.map((call) => call.args), [["OPENROUTER_API_KEY"]]);
  assertEquals(_fetchStub.calls.length, 0);
});

Deno.test("modelInfo reads the credential store before create and uses the default models endpoint", async () => {
  using readStub = stub(SecureCredentialStore, "get", () => Promise.resolve("stored-test-key"));
  const requests: Array<{ url: string; authorization: string | null }> = [];
  using _fetchStub = stub(globalThis, "fetch", (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
    return Promise.resolve(Response.json(FACTORY_CATALOG));
  });
  await withEnv({ OPENROUTER_API_KEY: null }, async () => {
    const info = await new OpenRouterProviderFactory().modelInfo(FACTORY_MODEL);
    assertEquals(info?.contextWindow, FACTORY_CONTEXT_WINDOW);
  });
  assertEquals(requests, [{ url: "https://openrouter.ai/api/v1/models", authorization: "Bearer stored-test-key" }]);
  assertEquals(readStub.calls.length, 1);
});

Deno.test("[security] modelInfo never writes the credential store even when environment persistence is enabled", async () => {
  const persistence = globalThis as typeof globalThis & { EXA_PERSIST_ENV_CREDENTIALS?: boolean };
  const previous = persistence.EXA_PERSIST_ENV_CREDENTIALS;
  using readStub = stub(SecureCredentialStore, "get", () => Promise.resolve(null));
  using writeStub = stub(SecureCredentialStore, "set", () => {
    throw new Error("metadata must not persist a key");
  });
  using _fetchStub = stub(globalThis, "fetch", (_input, init) => {
    assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer environment-test-key");
    return Promise.resolve(Response.json(FACTORY_CATALOG));
  });
  persistence.EXA_PERSIST_ENV_CREDENTIALS = true;
  try {
    await withEnv({ OPENROUTER_API_KEY: "environment-test-key" }, async () => {
      assertEquals(
        (await new OpenRouterProviderFactory().modelInfo(FACTORY_MODEL))?.contextWindow,
        FACTORY_CONTEXT_WINDOW,
      );
    });
    assertEquals(readStub.calls.length, 0);
    assertEquals(writeStub.calls.length, 0);
  } finally {
    if (previous === undefined) delete persistence.EXA_PERSIST_ENV_CREDENTIALS;
    else persistence.EXA_PERSIST_ENV_CREDENTIALS = previous;
  }
});

Deno.test("modelInfo returns undefined within OPENROUTER_MODEL_INFO_TIMEOUT_MS when the endpoint does not answer", async () => {
  const signals: AbortSignal[] = [];
  const deadlines: number[] = [];
  const realTimeout = AbortSignal.timeout;
  using _timeoutStub = stub(AbortSignal, "timeout", (duration) => {
    deadlines.push(duration);
    return realTimeout(1);
  });
  using _fetchStub = stub(globalThis, "fetch", (_input, init) => {
    const signal = init?.signal;
    assert(signal);
    signals.push(signal);
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    );
  });
  await withEnv({ OPENROUTER_API_KEY: "sk-test" }, async () => {
    for (const createFirst of [false, true]) {
      const factory = new OpenRouterProviderFactory();
      if (createFirst) {
        await factory.create({
          provider: ProviderType.OPENROUTER,
          model: FACTORY_MODEL,
          apiKey: "sk-test",
          timeoutMs: 60_000,
        });
      }
      const started = performance.now();
      assertEquals(await factory.modelInfo(FACTORY_MODEL), undefined);
      assert(performance.now() - started < MODEL_INFO_BOUND_MS + TEST_DEADLINE_TOLERANCE_MS);
      assertEquals(await factory.modelInfo(FACTORY_MODEL), undefined);
    }
  });
  assertEquals(signals.length, 2);
  assertEquals(deadlines, [MODEL_INFO_BOUND_MS, MODEL_INFO_BOUND_MS]);
  assert(signals.every((signal) => signal.aborted));
});

Deno.test("OpenRouterProviderFactory reads api_key_env from config", async () => {
  await withEnv({ OPENROUTER_API_KEY: null, CUSTOM_OR_KEY: "sk-zzz" }, async () => {
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
  });
});

Deno.test("a lookup first built by modelInfo journals openrouter.capability_lookup.failed after create() supplies a logger", async () => {
  const clockOffset = { ms: 0 };
  const realNow = Date.now;
  using _clock = stub(Date, "now", () => realNow() + clockOffset.ms);
  using _fetchStub = stub(globalThis, "fetch", () => Promise.resolve(new Response("down", { status: 500 })));
  await withEnv({ OPENROUTER_API_KEY: "sk-test" }, async () => {
    const factory = new OpenRouterProviderFactory();
    assertEquals(await factory.modelInfo(FACTORY_MODEL), undefined);
    const logger = createMockLogger();
    await factory.create({
      provider: ProviderType.OPENROUTER,
      model: FACTORY_MODEL,
      timeoutMs: 60_000,
      logger,
    });
    clockOffset.ms += LOOKUP_BACKOFF_PASSED_MS;
    assertEquals(await factory.modelInfo(FACTORY_MODEL), undefined);
    assertEquals(logger.warn.calls.map((call) => call.args[0]), [DomainEventType.OpenRouterCapabilityLookupFailed]);
  });
});
