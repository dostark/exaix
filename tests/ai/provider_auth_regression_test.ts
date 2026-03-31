/**
 * @module ProviderAuthRegressionTest
 * @path tests/ai/provider_auth_regression_test.ts
 * @description Regression tests for LLM provider authentication, ensuring stable loading
 * of API keys from environment variables across different provider factories.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { AnthropicProviderFactory } from "../../src/ai/factories/anthropic_factory.ts";
import { GoogleProviderFactory } from "../../src/ai/factories/google_factory.ts";
import { OpenAIProviderFactory } from "../../src/ai/factories/openai_factory.ts";
import { IResolvedProviderOptions } from "../../src/ai/types.ts";
import { MockStrategy, ProviderType } from "../../src/shared/enums.ts";
import { SecureCredentialStore } from "../../src/helpers/credential_security.ts";
import * as TEST_CONSTANTS from "../config/constants.ts";

const TEST_KEY_ANTHROPIC = "sk-ant-test-key";
const TEST_KEY_OPENAI = "sk-test-key";
const TEST_KEY_GOOGLE = "test-api-key";
const PERSIST_ENV_VAR = "EXA_PERSIST_ENV_CREDENTIALS";
const TEST_MODEL = "test-model";

// Helper to mock resolved options
const mockOptions: IResolvedProviderOptions = {
  provider: ProviderType.ANTHROPIC,
  model: TEST_MODEL,
  timeoutMs: 1000,
  mockStrategy: MockStrategy.RECORDED,
};

Deno.test("[regression] AnthropicProviderFactory accepts API key from environment", async () => {
  const factory = new AnthropicProviderFactory();

  // Set env var
  Deno.env.set(TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY, TEST_KEY_ANTHROPIC);

  try {
    const provider = await factory.create(mockOptions);
    assertEquals(provider.id, `anthropic-${TEST_MODEL}`);
  } finally {
    Deno.env.delete(TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY);
  }
});

Deno.test("[regression] AnthropicProviderFactory throws specific error when key missing", async () => {
  const factory = new AnthropicProviderFactory();

  // Ensure no key
  Deno.env.delete(TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY);
  await SecureCredentialStore.clear(TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY);

  await assertRejects(
    async () => await factory.create(mockOptions),
    Error,
    `Authentication failed: ${TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY} not found`,
  );
});

Deno.test("[regression] OpenAIProviderFactory accepts API key from environment", async () => {
  const factory = new OpenAIProviderFactory();
  Deno.env.set(TEST_CONSTANTS.ENV_OPENAI_API_KEY, TEST_KEY_OPENAI);

  try {
    const provider = await factory.create({ ...mockOptions, provider: ProviderType.OPENAI });
    assertEquals(provider.id, `openai-${TEST_MODEL}`);
  } finally {
    Deno.env.delete(TEST_CONSTANTS.ENV_OPENAI_API_KEY);
  }
});

Deno.test("[regression] GoogleProviderFactory accepts API key from environment", async () => {
  const factory = new GoogleProviderFactory();
  Deno.env.set(TEST_CONSTANTS.ENV_GOOGLE_API_KEY, TEST_KEY_GOOGLE);

  try {
    const provider = await factory.create({ ...mockOptions, provider: ProviderType.GOOGLE });
    assertEquals(provider.id, `google-${TEST_MODEL}`);
  } finally {
    Deno.env.delete(TEST_CONSTANTS.ENV_GOOGLE_API_KEY);
  }
});

// Helper for env→store sync tests
async function testEnvToStoreSync({
  providerName,
  factory,
  envKey,
  envValue,
  options,
}: {
  providerName: string;
  factory: AnthropicProviderFactory | OpenAIProviderFactory | GoogleProviderFactory;
  envKey: string;
  envValue: string;
  options: IResolvedProviderOptions;
}) {
  // Persist if opted in
  Deno.env.set(envKey, envValue);
  await SecureCredentialStore.clear(envKey);
  interface ExaGlobal {
    EXA_PERSIST_ENV_CREDENTIALS?: boolean;
  }
  const globalWithPersistence = globalThis as typeof globalThis & ExaGlobal;
  globalWithPersistence[PERSIST_ENV_VAR] = true;
  try {
    await factory.create(options);
    const stored = await SecureCredentialStore.get(envKey);
    assertEquals(stored, envValue, `[${providerName}] should persist env key to store when opted in`);
  } finally {
    Deno.env.delete(envKey);
    await SecureCredentialStore.clear(envKey);
    delete globalWithPersistence[PERSIST_ENV_VAR];
  }

  // Do NOT persist if not opted in
  Deno.env.set(envKey, envValue);
  await SecureCredentialStore.clear(envKey);
  globalWithPersistence[PERSIST_ENV_VAR] = false;
  try {
    await factory.create(options);
    const stored = await SecureCredentialStore.get(envKey);
    assertEquals(stored, null, `[${providerName}] should NOT persist env key to store when not opted in`);
  } finally {
    Deno.env.delete(envKey);
    await SecureCredentialStore.clear(envKey);
    delete globalWithPersistence[PERSIST_ENV_VAR];
  }
}

Deno.test("[env→store sync] Anthropic, OpenAI, Google: env key persistence opt-in/out", async () => {
  await testEnvToStoreSync({
    providerName: "Anthropic",
    factory: new AnthropicProviderFactory(),
    envKey: TEST_CONSTANTS.ENV_ANTHROPIC_API_KEY,
    envValue: TEST_KEY_ANTHROPIC,
    options: mockOptions,
  });
  await testEnvToStoreSync({
    providerName: "OpenAI",
    factory: new OpenAIProviderFactory(),
    envKey: TEST_CONSTANTS.ENV_OPENAI_API_KEY,
    envValue: TEST_KEY_OPENAI,
    options: { ...mockOptions, provider: ProviderType.OPENAI },
  });
  await testEnvToStoreSync({
    providerName: "Google",
    factory: new GoogleProviderFactory(),
    envKey: TEST_CONSTANTS.ENV_GOOGLE_API_KEY,
    envValue: TEST_KEY_GOOGLE,
    options: { ...mockOptions, provider: ProviderType.GOOGLE },
  });
});
