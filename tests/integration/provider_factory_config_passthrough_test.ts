/**
 * @module ProviderFactoryConfigPassthroughTest
 * @path tests/integration/provider_factory_config_passthrough_test.ts
 * @description The Google and native OpenAI factories pass the configuration to their providers, so the
 *   ai_retry.providers, ai_endpoints and ai_timeout.providers blocks apply to a factory-built provider.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/ai-google, @exaix/ai-openai, @exaix/schemas, @exaix/testing]
 * @related-files [packages/ai-google/src/google_factory.ts, packages/ai-openai/src/openai_factory.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { ProviderType } from "@exaix/core";
import type { Config } from "@exaix/schemas";
import { createMockConfig, withEnv } from "@exaix/testing";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import { BaseProvider } from "@exaix/ai/providers";
import { GoogleProviderFactory } from "@exaix/ai-google";
import { OpenAIProviderFactory } from "@exaix/ai-openai";

const CONFIGURED_ATTEMPTS = 2;
const CONFIGURED_TIMEOUT_MS = 12_345;
const BACKOFF_BASE_MS = 100;
const FACTORY_TIMEOUT_MS = 30_000;
const ENDPOINT_HOST = "https://configured.example";

interface IFactoryCase {
  name: string;
  factory: IProviderFactory;
  provider: ProviderType;
  model: string;
  keyEnv: string;
  endpoint: string;
  /** Where the provider sends requests. Native OpenAI rewrites the chat endpoint to its Responses path. */
  urlPrefix: string;
}

const CASES: IFactoryCase[] = [
  {
    name: "google",
    factory: new GoogleProviderFactory(),
    provider: ProviderType.GOOGLE,
    model: "gemini-2.5-pro",
    keyEnv: "GOOGLE_API_KEY",
    endpoint: `${ENDPOINT_HOST}/google`,
    urlPrefix: `${ENDPOINT_HOST}/google`,
  },
  {
    name: "openai",
    factory: new OpenAIProviderFactory(),
    provider: ProviderType.OPENAI,
    model: "gpt-5",
    keyEnv: "OPENAI_API_KEY",
    endpoint: `${ENDPOINT_HOST}/openai/v1/chat/completions`,
    urlPrefix: `${ENDPOINT_HOST}/openai/v1/`,
  },
];

function configFor(name: string, endpoint: string): Config {
  return createMockConfig("/tmp/factory-config-passthrough", {
    ai_retry: {
      max_attempts: 3,
      backoff_base_ms: BACKOFF_BASE_MS,
      timeout_per_request_ms: FACTORY_TIMEOUT_MS,
      retry_after_max_ms: 60_000,
      providers: { [name]: { max_attempts: CONFIGURED_ATTEMPTS, backoff_base_ms: BACKOFF_BASE_MS } },
    },
    ai_timeout: { default_ms: FACTORY_TIMEOUT_MS, providers: { [name]: CONFIGURED_TIMEOUT_MS } },
    ai_endpoints: { [name]: endpoint },
  } as Partial<Config>);
}

for (const { name, factory, provider, model, keyEnv, endpoint, urlPrefix } of CASES) {
  Deno.test(`[factory-config] the ${name} factory applies ai_retry.providers, ai_timeout.providers and ai_endpoints`, async () => {
    const urls: string[] = [];
    using _fetchStub = stub(globalThis, "fetch", (input) => {
      urls.push(String(input));
      return Promise.resolve(new Response("{}", { status: 503 }));
    });
    await withEnv({ [keyEnv]: "sk-test" }, async () => {
      const created = await factory.create({
        provider,
        model,
        timeoutMs: FACTORY_TIMEOUT_MS,
        config: configFor(name, endpoint),
      });
      if (!(created instanceof BaseProvider)) throw new Error("expected a BaseProvider subclass");
      assertEquals(created.timeoutMs, CONFIGURED_TIMEOUT_MS);
      await assertRejects(() => created.generate("hi", { traceId: crypto.randomUUID() }));
    });
    assertEquals(urls.length, CONFIGURED_ATTEMPTS);
    assertEquals(urls.every((url) => url.startsWith(urlPrefix)), true);
  });
}
