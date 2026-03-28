/**
 * @module AIProviderFactoryTest
 * @path tests/ai/provider_factory_test.ts
 * @description Verifies the AI Provider Factory, ensuring robust parsing of
 * provider-specific configuration and stable initialization of model instances.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { ProviderFactory } from "../../src/ai/provider_factory.ts";
import { TEST_MODEL_ANTHROPIC, TEST_MODEL_OPENAI } from "../config/constants.ts";
import { ProviderFactoryError } from "../../src/ai/errors.ts";
import { RateLimitError } from "../../src/ai/rate_limited_provider.ts";
import { SecureCredentialStore } from "../../src/helpers/credential_security.ts";
import { DaemonStatus, MockStrategy, ProviderType } from "../../src/shared/enums.ts";

import { AiConfigSchema } from "../../src/shared/schemas/ai_config.ts";
import { createTestConfig, getProviderForModel } from "./helpers/test_config.ts";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Helper to set env vars and clean up after test
 */
function withEnvVars(
  vars: Record<string, string>,
  fn: () => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    // Set vars
    for (const [key, value] of Object.entries(vars)) {
      Deno.env.set(key, value);
    }
    try {
      await fn();
    } finally {
      // Clean up
      for (const key of Object.keys(vars)) {
        Deno.env.delete(key);
      }
    }
  };
}

// ============================================================================
// AI Config Schema Tests
// ============================================================================

Deno.test("AiConfigSchema: accepts valid config", () => {
  const validConfig = {
    provider: ProviderType.MOCK,
    model: "llama3.2",
    base_url: "http://localhost:11434",
    timeout_ms: 30000,
    max_tokens: 4096,
    temperature: 0.7,
  };

  const result = AiConfigSchema.safeParse(validConfig);
  assertEquals(result.success, true);
});

Deno.test("AiConfigSchema: accepts minimal config", () => {
  const minimalConfig = {
    provider: ProviderType.OLLAMA,
  };

  const result = AiConfigSchema.safeParse(minimalConfig);
  assertEquals(result.success, true);
});

Deno.test("AiConfigSchema: provides defaults", () => {
  const minimalConfig = {
    provider: ProviderType.MOCK,
  };

  const result = AiConfigSchema.parse(minimalConfig);
  assertEquals(result.provider, ProviderType.MOCK);
  assertEquals(result.timeout_ms, 30000); // default
});

Deno.test("AiConfigSchema: validates provider enum", () => {
  const invalidConfig = {
    provider: "invalid-provider",
  };

  // Schema now allows any provider name - validation happens at runtime
  const result = AiConfigSchema.safeParse(invalidConfig);
  assertEquals(result.success, true);
});

Deno.test("AiConfigSchema: validates timeout_ms range", () => {
  const invalidConfig = {
    provider: ProviderType.MOCK,
    timeout_ms: -100,
  };

  const result = AiConfigSchema.safeParse(invalidConfig);
  assertEquals(result.success, false);
});

// ============================================================================
// Default Provider Tests
// ============================================================================

Deno.test("ProviderFactory: defaults to MockLLMProvider when no config", async () => {
  const config = createTestConfig();
  config.rate_limiting.enabled = false; // Disable rate limiting for this test
  const provider = await ProviderFactory.create(config);

  assertExists(provider);
  assertEquals(provider.id.startsWith("mock"), true, `Expected mock provider, got: ${provider.id}`);
});

Deno.test("ProviderFactory: defaults to MockLLMProvider when ai section missing", async () => {
  const config = createTestConfig(undefined);
  config.rate_limiting.enabled = false; // Disable rate limiting for this test
  const provider = await ProviderFactory.create(config);

  assertExists(provider);
  assertEquals(provider.id.startsWith("mock"), true);
});

// ============================================================================
// Environment Variable Tests
// ============================================================================

Deno.test(
  "ProviderFactory: EXA_LLM_PROVIDER=mock creates MockLLMProvider",
  withEnvVars({ EXA_LLM_PROVIDER: "mock" }, async () => {
    const config = createTestConfig();
    config.rate_limiting.enabled = false; // Disable rate limiting for this test
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertEquals(provider.id.startsWith("mock"), true);
  }),
);

Deno.test(
  "ProviderFactory: EXA_LLM_PROVIDER=ollama creates OllamaProvider",
  withEnvVars({ EXA_LLM_PROVIDER: "ollama" }, async () => {
    const config = createTestConfig();
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertStringIncludes(provider.id, "ollama");
  }),
);

Deno.test(
  "ProviderFactory: EXA_LLM_MODEL overrides config model",
  withEnvVars({ EXA_LLM_PROVIDER: "ollama", EXA_LLM_MODEL: "codellama" }, async () => {
    const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertStringIncludes(provider.id, "codellama");
  }),
);

Deno.test(
  "ProviderFactory: env var overrides config",
  withEnvVars({ EXA_LLM_PROVIDER: "mock" }, async () => {
    const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
    config.rate_limiting.enabled = false; // Disable rate limiting for this test
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertEquals(provider.id.startsWith("mock"), true, "Environment should override config");
  }),
);

// ============================================================================
// Config File Tests
// ============================================================================

Deno.test("ProviderFactory: config ai.provider=ollama creates OllamaProvider", async () => {
  const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
  const provider = await ProviderFactory.create(config);

  assertExists(provider);
  assertStringIncludes(provider.id, "ollama");
  assertStringIncludes(provider.id, "llama3.2");
});

Deno.test("ProviderFactory: config ai.provider=mock creates MockLLMProvider", async () => {
  const config = createTestConfig({ provider: ProviderType.MOCK });
  config.rate_limiting.enabled = false; // Disable rate limiting for this test
  const provider = await ProviderFactory.create(config);

  assertExists(provider);
  assertEquals(provider.id.startsWith("mock"), true);
});

// ============================================================================
// API Key Tests
// ============================================================================

Deno.test(
  "ProviderFactory: anthropic requires ANTHROPIC_API_KEY",
  withEnvVars({ EXA_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" }, async () => {
    // Ensure API key is not in secure store
    SecureCredentialStore.clear("ANTHROPIC_API_KEY");

    const config = createTestConfig();

    await assertRejects(
      async () => await ProviderFactory.create(config),
      ProviderFactoryError,
      "Authentication failed",
    );
  }),
);

Deno.test(
  "ProviderFactory: openai requires OPENAI_API_KEY",
  withEnvVars({ EXA_LLM_PROVIDER: "openai", OPENAI_API_KEY: "" }, async () => {
    // Ensure API key is not in secure store
    SecureCredentialStore.clear("OPENAI_API_KEY");

    const config = createTestConfig();

    await assertRejects(
      async () => await ProviderFactory.create(config),
      ProviderFactoryError,
      "Authentication failed",
    );
  }),
);

// ============================================================================
// Unknown Provider Tests
// ============================================================================

Deno.test(
  "ProviderFactory: unknown provider falls back to mock with warning",
  withEnvVars({ EXA_LLM_PROVIDER: "unknown-provider-xyz" }, async () => {
    const config = createTestConfig();

    // Capture console.warn output
    const originalWarn = console.warn;
    const warningMessages: string[] = [];
    console.warn = (msg: string) => {
      warningMessages.push(msg);
    };

    try {
      config.rate_limiting.enabled = false; // Disable rate limiting for this test
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertEquals(provider.id.startsWith("mock"), true, "Should fall back to mock");

      // Check that at least one warning mentions the unknown provider
      const hasProviderWarning = warningMessages.some((msg) => msg.includes("unknown-provider-xyz"));
      assertEquals(hasProviderWarning, true, "Should warn about unknown provider");
    } finally {
      console.warn = originalWarn;
    }
  }),
);

// ============================================================================
// Provider Options Tests
// ============================================================================

Deno.test(
  "ProviderFactory: EXA_LLM_BASE_URL sets base URL for Ollama",
  withEnvVars({
    EXA_LLM_PROVIDER: "ollama",
    EXA_LLM_BASE_URL: "http://custom-host:8080",
  }, async () => {
    const config = createTestConfig();
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    // Provider should be created (we can't easily test internal baseUrl)
    assertStringIncludes(provider.id, "ollama");
  }),
);

Deno.test(
  "ProviderFactory: EXA_LLM_TIMEOUT_MS sets timeout",
  withEnvVars({
    EXA_LLM_PROVIDER: "ollama",
    EXA_LLM_TIMEOUT_MS: "60000",
  }, async () => {
    const config = createTestConfig();
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    // Provider should be created (we can't easily test internal timeout)
    assertStringIncludes(provider.id, "ollama");
  }),
);

// ============================================================================
// MockLLMProvider Strategy Tests
// ============================================================================

Deno.test("ProviderFactory: mock strategy from config", async () => {
  const config = createTestConfig({
    provider: ProviderType.MOCK,
    mock: {
      strategy: MockStrategy.SCRIPTED,
    },
  });
  config.rate_limiting.enabled = false; // Disable rate limiting for this test
  const provider = await ProviderFactory.create(config);

  assertExists(provider);
  assertEquals(provider.id.startsWith("mock"), true);
});

// ============================================================================
// Integration with IModelProvider Tests
// ============================================================================

Deno.test("ProviderFactory: created provider implements IModelProvider", async () => {
  // Use scripted strategy for testing (doesn't require recorded fixtures)
  const config = createTestConfig({ provider: "mock", mock: { strategy: MockStrategy.SCRIPTED } });
  const provider = await ProviderFactory.create(config);

  // Should have id property
  assertExists(provider.id);
  assertEquals(typeof provider.id, "string");

  // Should have generate method
  assertEquals(typeof provider.generate, "function");

  // Should be able to generate
  const response = await provider.generate("Test prompt");
  assertEquals(typeof response, "string");
});

Deno.test("ProviderFactory: provider can be used for plan generation", async () => {
  // Use scripted strategy for testing (doesn't require recorded fixtures)
  const config = createTestConfig({ provider: "mock", mock: { strategy: MockStrategy.SCRIPTED } });
  const provider = await ProviderFactory.create(config);

  const response = await provider.generate("Implement a feature for user authentication");
  assertExists(response);
  assertEquals(typeof response, "string");
});

// ============================================================================
// getProviderInfo Tests
// ============================================================================

Deno.test("ProviderFactory: getProviderInfo returns provider details", () => {
  const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
  const info = ProviderFactory.getProviderInfo(config);

  assertEquals(info.type, "ollama");
  assertEquals(info.model, "llama3.2");
  assertExists(info.id);
});

Deno.test(
  "ProviderFactory: getProviderInfo respects env vars",
  withEnvVars({ EXA_LLM_PROVIDER: "ollama" }, () => {
    const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
    const info = ProviderFactory.getProviderInfo(config);

    assertEquals(info.type, "ollama");
    assertEquals(info.model, "llama3.2");
  }),
);

// ============================================================================
// Anthropic Provider Placeholder Tests
// ============================================================================

Deno.test(
  "ProviderFactory: anthropic with API key returns placeholder MockLLMProvider",
  withEnvVars({
    EXA_LLM_PROVIDER: "anthropic",
    EXA_LLM_MODEL: TEST_MODEL_ANTHROPIC,
  }, async () => {
    // Initialize secure store with test key
    await SecureCredentialStore.set("ANTHROPIC_API_KEY", "test-key");

    const config = createTestConfig();
    config.rate_limiting.enabled = false; // Disable rate limiting for this test
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertStringIncludes(provider.id, `anthropic-${TEST_MODEL_ANTHROPIC}`);
    // Should be a MockLLMProvider placeholder
    assertEquals(provider.id.startsWith("anthropic"), true);

    // Clean up
    SecureCredentialStore.clear("ANTHROPIC_API_KEY");
  }),
);

// ============================================================================
// OpenAI Provider Placeholder Tests
// ============================================================================

Deno.test(
  "ProviderFactory: openai with API key returns placeholder MockLLMProvider",
  withEnvVars({
    EXA_LLM_PROVIDER: "openai",
    EXA_LLM_MODEL: TEST_MODEL_OPENAI,
  }, async () => {
    // Initialize secure store with test key
    await SecureCredentialStore.set("OPENAI_API_KEY", "test-key");

    const config = createTestConfig();
    config.rate_limiting.enabled = false; // Disable rate limiting for this test
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertStringIncludes(provider.id, `openai-${TEST_MODEL_OPENAI}`);
    // Should be a MockLLMProvider placeholder
    assertEquals(provider.id.startsWith("openai"), true);

    // Clean up
    SecureCredentialStore.clear("OPENAI_API_KEY");
  }),
);

// ============================================================================
// Llama Model Routing Tests
// ============================================================================

Deno.test("ProviderFactory: llama model prefix routes to LlamaProvider", async () => {
  const config = createTestConfig({
    provider: ProviderType.OLLAMA,
    model: "codellama:13b",
  });
  const provider = await ProviderFactory.create(config);

  assertExists(provider);
  // Should route to LlamaProvider despite ollama config
  assertStringIncludes(provider.id, "codellama");
});

Deno.test("ProviderFactory: llama model prefix routes to LlamaProvider from env", async () => {
  const config = createTestConfig();
  // Set env to use codellama model
  Deno.env.set("EXA_LLM_MODEL", "llama3.2:8b");

  try {
    const provider = await ProviderFactory.create(config);
    assertExists(provider);
    assertStringIncludes(provider.id, "llama3.2");
  } finally {
    Deno.env.delete("EXA_LLM_MODEL");
  }
});

// ============================================================================
// Unknown Provider ID Generation Test
// ============================================================================

Deno.test("ProviderFactory: unknown provider generates unknown ID", () => {
  // This tests the default case in generateProviderId
  // We need to access the private method, so we'll test via getProviderInfo
  const config = createTestConfig();

  // Mock the resolveOptions to return unknown provider
  const originalResolveOptions = ProviderFactory["resolveOptions"];
  ProviderFactory["resolveOptions"] = (() => ({
    provider: "unknown" as ProviderType,
    model: "test-model",
    timeoutMs: 30000,
  })) as () => { provider: ProviderType; model: string; timeoutMs: number };

  try {
    const info = ProviderFactory.getProviderInfo(config);
    assertEquals(info.id, "unknown-test-model");
  } finally {
    ProviderFactory["resolveOptions"] = originalResolveOptions;
  }
});

// ============================================================================
// getProviderForModel Helper Tests
// ============================================================================

Deno.test("getProviderForModel: creates provider for model", async () => {
  const provider = await getProviderForModel("codellama:13b");

  assertExists(provider);
  assertStringIncludes(provider.id, "codellama");
});

Deno.test("getProviderForModel: handles regular ollama models", async () => {
  const provider = await getProviderForModel("llama3.2");

  assertExists(provider);
  assertStringIncludes(provider.id, "llama3.2");
});

// ============================================================================
// Named Model Tests
// ============================================================================
Deno.test("ProviderFactory: createWithFallback returns primary if healthy", async () => {
  const config = createTestConfig();
  config.models = {
    primary: { provider: ProviderType.MOCK, model: "primary-mock", timeout_ms: 30000 },
    fallback: { provider: ProviderType.MOCK, model: "fallback-mock", timeout_ms: 30000 },
  };
  const provider = await ProviderFactory.createWithFallback(config, {
    primary: "primary",
    fallbacks: ["fallback"],
    healthCheck: false,
  });
  assertExists(provider);
  assertStringIncludes(provider.id, "primary-mock");
});

Deno.test("ProviderFactory: createWithFallback falls back if primary fails", async () => {
  const config = createTestConfig();
  config.models = {
    primary: { provider: ProviderType.ANTHROPIC, model: "bad-model", timeout_ms: 30000 },
    fallback: { provider: ProviderType.MOCK, model: "fallback-mock", timeout_ms: 30000 },
  };
  // Ensure no API key for anthropic
  Deno.env.set("ANTHROPIC_API_KEY", "");
  SecureCredentialStore.clear("ANTHROPIC_API_KEY");

  try {
    const provider = await ProviderFactory.createWithFallback(config, {
      primary: "primary",
      fallbacks: ["fallback"],
      healthCheck: false,
    });
    assertExists(provider);
    assertStringIncludes(provider.id, "fallback-mock");
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
  }
});

Deno.test("ProviderFactory: createWithFallback throws if all fail", async () => {
  const config = createTestConfig();
  config.models = {
    primary: { provider: ProviderType.ANTHROPIC, model: "bad-model", timeout_ms: 30000 },
    fallback: { provider: ProviderType.ANTHROPIC, model: "bad-model", timeout_ms: 30000 },
  };
  // Ensure no API key for anthropic
  Deno.env.set("ANTHROPIC_API_KEY", "");
  SecureCredentialStore.clear("ANTHROPIC_API_KEY");

  try {
    await assertRejects(
      () =>
        ProviderFactory.createWithFallback(config, {
          primary: "primary",
          fallbacks: ["fallback"],
          healthCheck: false,
        }),
      ProviderFactoryError,
      "All providers in fallback chain failed",
    );
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
  }
});

Deno.test("ProviderFactory: createWithFallback healthCheck calls validateConnection", async () => {
  // Custom provider with validateConnection
  class TestProvider {
    id = "test-provider";
    validateConnection() {
      return true;
    }
    generate() {
      return Promise.resolve("ok");
    }
  }
  // Patch ProviderFactory.createByName to return TestProvider for this test
  const originalCreateByName = ProviderFactory.createByName;
  ProviderFactory.createByName = (_config: any, _name: string) => Promise.resolve(new TestProvider());
  try {
    const config = createTestConfig();
    const provider = await ProviderFactory.createWithFallback(config, {
      primary: "test",
      fallbacks: [],
      healthCheck: true,
    });
    assertExists(provider);
    assertEquals(provider.id, "test-provider");
  } finally {
    ProviderFactory.createByName = originalCreateByName;
  }
});

Deno.test("ProviderFactory: createByName creates correct named provider", async () => {
  const config = createTestConfig();
  // Override models for testing
  config.models = {
    default: { provider: ProviderType.MOCK, model: "default-mock", timeout_ms: 30000 },
    fast: { provider: ProviderType.MOCK, model: "fast-mock", timeout_ms: 15000 },
  };

  const fastProvider = await ProviderFactory.createByName(config, "fast");
  assertStringIncludes(fastProvider.id, "fast-mock");

  const defaultProvider = await ProviderFactory.createByName(config, "default");
  assertStringIncludes(defaultProvider.id, "default-mock");
});

Deno.test("ProviderFactory: createByName falls back to default for unknown name", async () => {
  const config = createTestConfig();
  config.models = {
    default: { provider: ProviderType.MOCK, model: "default-mock", timeout_ms: 30000 },
  };

  const unknownProvider = await ProviderFactory.createByName(config, DaemonStatus.UNKNOWN);
  assertStringIncludes(unknownProvider.id, "default-mock");
});

Deno.test("ProviderFactory: applies rate limiting when enabled", async () => {
  const config = createTestConfig({
    provider: "mock",
    model: "test-model",
  });

  // Enable rate limiting with low limits for testing
  config.rate_limiting = {
    enabled: true,
    max_calls_per_minute: 1,
    max_tokens_per_hour: 1000,
    max_cost_per_day: 1,
    cost_per_1k_tokens: 0.1,
  };

  const provider = await ProviderFactory.create(config);

  // Should be wrapped with RateLimitedProvider
  assertStringIncludes(provider.id, "rate-limited");

  // Second call should be blocked by rate limit
  await provider.generate("test");
  await assertRejects(
    () => provider.generate("test"),
    RateLimitError,
    "calls per minute",
  );
});

Deno.test("ProviderFactory: skips rate limiting when disabled", async () => {
  const config = createTestConfig({
    provider: "mock",
    model: "test-model",
  });

  // Disable rate limiting
  config.rate_limiting = {
    enabled: false,
    max_calls_per_minute: 1,
    max_tokens_per_hour: 1000,
    max_cost_per_day: 1,
    cost_per_1k_tokens: 0.1,
  };

  const provider = await ProviderFactory.create(config);

  // Should not be wrapped with RateLimitedProvider
  assertStringIncludes(provider.id, "mock");
});

Deno.test("ProviderFactory: getProviderInfoByName returns named provider details", () => {
  const config = createTestConfig();
  config.models = {
    fast: { provider: "mock", model: "fast-mock", timeout_ms: 15000 },
  };

  const info = ProviderFactory.getProviderInfoByName(config, "fast");
  assertEquals(info.model, "fast-mock");
  assertEquals(info.type, "mock");
});
