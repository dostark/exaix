/**
 * @module AIConfigSchemaTest
 * @path tests/config/ai_config_test.ts
 * @description Verifies the configuration schema for AI providers, ensuring correct
 * parsing of base URLs, model identifiers, and default model mappings.
 */

import { assert, assertEquals } from "@std/assert";
import {
  AiConfigSchema,
  getDefaultEndpoints,
  getDefaultModels,
  getDefaultRetryConfig,
} from "@exaix/schemas/ai_config.ts";
import { initializeRegistry, ProviderRegistry } from "@exaix/ai";
import {
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_ANTHROPIC_ENDPOINT,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
  DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_GOOGLE_RETRY_BACKOFF_MS,
  DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS,
  DEFAULT_MOCK_MODEL,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_RETRY_BACKOFF_MS,
  DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENAI_ENDPOINT,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_RETRY_BACKOFF_MS,
  DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
} from "@exaix/ai";
import { PricingTier, ProviderCostTier, ProviderType } from "@exaix/core";
import type { IProviderFactory } from "../../src/ai/factories/abstract_provider_factory.ts";
import {
  TEST_AI_INVALID_URL,
  TEST_CUSTOM_PROVIDER_CAPABILITY,
  TEST_CUSTOM_PROVIDER_DESCRIPTION,
  TEST_CUSTOM_PROVIDER_ID,
  TEST_CUSTOM_PROVIDER_MODEL,
  TEST_CUSTOM_PROVIDER_NAME,
  TEST_CUSTOM_PROVIDER_RESPONSE,
  TEST_CUSTOM_PROVIDER_STRENGTH,
  TEST_CUSTOM_PROVIDER_TYPE,
  TEST_EMPTY_STRING,
  TEST_RETRY_BACKOFF_BASE_MS_ZERO,
  TEST_RETRY_MAX_ATTEMPTS_SINGLE,
} from "./constants.ts";

import type { IGenerateResult } from "../../src/ai/providers/common.ts";

const customProviderFactory: IProviderFactory = {
  create: () =>
    Promise.resolve({
      id: TEST_CUSTOM_PROVIDER_ID,
      generate: (): Promise<IGenerateResult> =>
        Promise.resolve({
          content: TEST_CUSTOM_PROVIDER_RESPONSE,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: TEST_CUSTOM_PROVIDER_MODEL,
          provider: TEST_CUSTOM_PROVIDER_NAME,
          cost_usd: 0,
        }),
    }),
};

function registerCustomProvider(): void {
  ProviderRegistry.registerWithMetadata(TEST_CUSTOM_PROVIDER_TYPE, customProviderFactory, {
    name: TEST_CUSTOM_PROVIDER_NAME,
    description: TEST_CUSTOM_PROVIDER_DESCRIPTION,
    capabilities: [TEST_CUSTOM_PROVIDER_CAPABILITY],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [TEST_CUSTOM_PROVIDER_STRENGTH],
  });
}

Deno.test("AiConfigSchema: accepts empty base_url", () => {
  const result = AiConfigSchema.safeParse({ base_url: TEST_EMPTY_STRING });
  assert(result.success);
});

Deno.test("AiConfigSchema: rejects invalid base_url", () => {
  const result = AiConfigSchema.safeParse({ base_url: TEST_AI_INVALID_URL });
  assert(!result.success);
});

Deno.test("getDefaultModels returns provider defaults", () => {
  ProviderRegistry.clear();
  initializeRegistry();
  registerCustomProvider();

  const models = getDefaultModels();

  assertEquals(models[ProviderType.MOCK], DEFAULT_MOCK_MODEL);
  assertEquals(models[ProviderType.OLLAMA], DEFAULT_OLLAMA_MODEL);
  assertEquals(models[ProviderType.ANTHROPIC], DEFAULT_ANTHROPIC_MODEL);
  assertEquals(models[ProviderType.OPENAI], DEFAULT_OPENAI_MODEL);
  assertEquals(models[ProviderType.GOOGLE], DEFAULT_GOOGLE_MODEL);
  assertEquals(models[TEST_CUSTOM_PROVIDER_TYPE], TEST_CUSTOM_PROVIDER_MODEL);

  ProviderRegistry.clear();
});

Deno.test("getDefaultEndpoints returns provider defaults", () => {
  ProviderRegistry.clear();
  initializeRegistry();
  registerCustomProvider();

  const endpoints = getDefaultEndpoints();

  assertEquals(endpoints[ProviderType.MOCK], TEST_EMPTY_STRING);
  assertEquals(endpoints[ProviderType.OLLAMA], DEFAULT_OLLAMA_ENDPOINT);
  assertEquals(endpoints[ProviderType.ANTHROPIC], DEFAULT_ANTHROPIC_ENDPOINT);
  assertEquals(endpoints[ProviderType.OPENAI], DEFAULT_OPENAI_ENDPOINT);
  assertEquals(endpoints[ProviderType.GOOGLE], DEFAULT_GOOGLE_ENDPOINT);
  assertEquals(endpoints[TEST_CUSTOM_PROVIDER_TYPE], TEST_EMPTY_STRING);

  ProviderRegistry.clear();
});

Deno.test("getDefaultRetryConfig returns provider defaults", () => {
  ProviderRegistry.clear();
  initializeRegistry();
  registerCustomProvider();

  const retryConfig = getDefaultRetryConfig();

  assertEquals(retryConfig[ProviderType.MOCK].maxAttempts, TEST_RETRY_MAX_ATTEMPTS_SINGLE);
  assertEquals(retryConfig[ProviderType.MOCK].backoffBaseMs, TEST_RETRY_BACKOFF_BASE_MS_ZERO);
  assertEquals(retryConfig[ProviderType.OLLAMA].maxAttempts, DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS);
  assertEquals(retryConfig[ProviderType.OLLAMA].backoffBaseMs, DEFAULT_OLLAMA_RETRY_BACKOFF_MS);
  assertEquals(retryConfig[ProviderType.ANTHROPIC].maxAttempts, DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS);
  assertEquals(retryConfig[ProviderType.ANTHROPIC].backoffBaseMs, DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS);
  assertEquals(retryConfig[ProviderType.OPENAI].maxAttempts, DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS);
  assertEquals(retryConfig[ProviderType.OPENAI].backoffBaseMs, DEFAULT_OPENAI_RETRY_BACKOFF_MS);
  assertEquals(retryConfig[ProviderType.GOOGLE].maxAttempts, DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS);
  assertEquals(retryConfig[ProviderType.GOOGLE].backoffBaseMs, DEFAULT_GOOGLE_RETRY_BACKOFF_MS);
  assertEquals(retryConfig[TEST_CUSTOM_PROVIDER_TYPE].maxAttempts, DEFAULT_AI_RETRY_MAX_ATTEMPTS);
  assertEquals(retryConfig[TEST_CUSTOM_PROVIDER_TYPE].backoffBaseMs, DEFAULT_AI_RETRY_BACKOFF_BASE_MS);

  ProviderRegistry.clear();
});
