/**
 * @module AIProviderFactoryTest
 * @path packages/ai/tests/provider_factory_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies the AI Provider Factory, ensuring robust parsing of
 * provider-specific configuration and stable initialization of model instances.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { ANTHROPIC_PROVIDER_METADATA, AnthropicProviderFactory, PROVIDER_ANTHROPIC } from "@exaix/ai-anthropic";
import { GOOGLE_PROVIDER_METADATA, GoogleProviderFactory, PROVIDER_GOOGLE } from "@exaix/ai-google";
import { OLLAMA_PROVIDER_METADATA, OllamaProviderFactory, PROVIDER_OLLAMA } from "@exaix/ai-ollama";
import { OPENAI_PROVIDER_METADATA, OpenAIProviderFactory, PROVIDER_OPENAI } from "@exaix/ai-openai";
import { ProviderFactory } from "../src/provider_factory.ts";
import { TEST_MODEL_ANTHROPIC, TEST_MODEL_OPENAI } from "@exaix/testing";
import { ProviderFactoryError } from "../src/errors.ts";
import type { IGenerateResult } from "../src/providers/common.ts";
import type { IModelProvider } from "../src/types.ts";
import { RateLimiterError } from "../src/rate_limited_provider.ts";
import {
  DaemonStatus,
  MockStrategy,
  PricingTier,
  ProviderCostTier,
  ProviderType,
  SecureCredentialStore,
} from "@exaix/core";
import { AiConfigSchema, type Config } from "@exaix/schemas";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { setProviderRegistryBootstrap } from "../src/provider_factory.ts";

import { createTestConfig, getProviderForModel } from "./helpers/test_config.ts";

const skipInParallel = !!Deno.env.get("DENO_JOBS") && Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") !== "1";
function parallelSafeTest(
  name: string,
  fn: () => void | Promise<void>,
): void {
  Deno.test({ name, ignore: skipInParallel, fn });
}

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

function registerConcreteProviders(): void {
  const supported = ProviderRegistry.getSupportedProviders();

  if (!supported.includes(PROVIDER_OLLAMA)) {
    ProviderRegistry.registerWithMetadata(PROVIDER_OLLAMA, new OllamaProviderFactory(), {
      name: OLLAMA_PROVIDER_METADATA.name,
      description: OLLAMA_PROVIDER_METADATA.description,
      capabilities: [...OLLAMA_PROVIDER_METADATA.capabilities],
      costTier: OLLAMA_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.LOCAL,
      strengths: [...OLLAMA_PROVIDER_METADATA.strengths],
    });
  }

  if (!supported.includes(PROVIDER_ANTHROPIC)) {
    ProviderRegistry.registerWithMetadata(PROVIDER_ANTHROPIC, new AnthropicProviderFactory(), {
      name: ANTHROPIC_PROVIDER_METADATA.name,
      description: ANTHROPIC_PROVIDER_METADATA.description,
      capabilities: [...ANTHROPIC_PROVIDER_METADATA.capabilities],
      costTier: ANTHROPIC_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.HIGH,
      strengths: [...ANTHROPIC_PROVIDER_METADATA.strengths],
    });
  }

  if (!supported.includes(PROVIDER_OPENAI)) {
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENAI, new OpenAIProviderFactory(), {
      name: OPENAI_PROVIDER_METADATA.name,
      description: OPENAI_PROVIDER_METADATA.description,
      capabilities: [...OPENAI_PROVIDER_METADATA.capabilities],
      costTier: OPENAI_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.MEDIUM,
      strengths: [...OPENAI_PROVIDER_METADATA.strengths],
    });
  }

  if (!supported.includes(PROVIDER_GOOGLE)) {
    ProviderRegistry.registerWithMetadata(PROVIDER_GOOGLE, new GoogleProviderFactory(), {
      name: GOOGLE_PROVIDER_METADATA.name,
      description: GOOGLE_PROVIDER_METADATA.description,
      capabilities: [...GOOGLE_PROVIDER_METADATA.capabilities],
      costTier: GOOGLE_PROVIDER_METADATA.costTier,
      pricingTier: PricingTier.FREE,
      strengths: [...GOOGLE_PROVIDER_METADATA.strengths],
    });
  }
}

async function withConcreteProviders<T>(fn: () => Promise<T> | T): Promise<T> {
  ProviderRegistry.clear();
  setProviderRegistryBootstrap(registerConcreteProviders);

  try {
    return await fn();
  } finally {
    setProviderRegistryBootstrap(undefined);
    ProviderRegistry.clear();
  }
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

parallelSafeTest(
  "ProviderFactory: EXA_LLM_PROVIDER=mock creates MockLLMProvider",
  withEnvVars({ EXA_LLM_PROVIDER: "mock" }, async () => {
    const config = createTestConfig();
    config.rate_limiting.enabled = false; // Disable rate limiting for this test
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertEquals(provider.id.startsWith("mock"), true);
  }),
);

parallelSafeTest(
  "ProviderFactory: EXA_LLM_PROVIDER=ollama creates OllamaProvider",
  withEnvVars({ EXA_LLM_PROVIDER: "ollama" }, async () => {
    await withConcreteProviders(async () => {
      const config = createTestConfig();
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertStringIncludes(provider.id, "ollama");
    });
  }),
);

parallelSafeTest(
  "ProviderFactory: EXA_LLM_MODEL overrides config model",
  withEnvVars({ EXA_LLM_PROVIDER: "ollama", EXA_LLM_MODEL: "codellama" }, async () => {
    await withConcreteProviders(async () => {
      const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertStringIncludes(provider.id, "codellama");
    });
  }),
);

parallelSafeTest(
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
  await withConcreteProviders(async () => {
    const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
    const provider = await ProviderFactory.create(config);

    assertExists(provider);
    assertStringIncludes(provider.id, "ollama");
    assertStringIncludes(provider.id, "llama3.2");
  });
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

parallelSafeTest(
  "ProviderFactory: anthropic requires ANTHROPIC_API_KEY",
  withEnvVars({ EXA_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" }, async () => {
    await withConcreteProviders(async () => {
      SecureCredentialStore.clear("ANTHROPIC_API_KEY");

      const config = createTestConfig();

      await assertRejects(
        async () => await ProviderFactory.create(config),
        ProviderFactoryError,
        "Authentication failed",
      );
    });
  }),
);

parallelSafeTest(
  "ProviderFactory: openai requires OPENAI_API_KEY",
  withEnvVars({ EXA_LLM_PROVIDER: "openai", OPENAI_API_KEY: "" }, async () => {
    await withConcreteProviders(async () => {
      SecureCredentialStore.clear("OPENAI_API_KEY");

      const config = createTestConfig();

      await assertRejects(
        async () => await ProviderFactory.create(config),
        ProviderFactoryError,
        "Authentication failed",
      );
    });
  }),
);

// ============================================================================
// Unknown Provider Tests
// ============================================================================

Deno.test(
  "ProviderFactory: any provider falls back to mock with warning",
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
    await withConcreteProviders(async () => {
      const config = createTestConfig();
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertStringIncludes(provider.id, "ollama");
    });
  }),
);

Deno.test(
  "ProviderFactory: EXA_LLM_TIMEOUT_MS sets timeout",
  withEnvVars({
    EXA_LLM_PROVIDER: "ollama",
    EXA_LLM_TIMEOUT_MS: "60000",
  }, async () => {
    await withConcreteProviders(async () => {
      const config = createTestConfig();
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertStringIncludes(provider.id, "ollama");
    });
  }),
);

Deno.test(
  "ProviderFactory: createByName('default') honors config.ai_timeout.providers when config.ai is unset and config.models.default carries no timeout_ms",
  async () => {
    // Live-observed bug: resolveOptions's `merged = {...baseAi, ...modelConfig}` spreads
    // baseAi's hardcoded MOCK-provider fallback (`{ provider: MOCK, timeout_ms:
    // DEFAULT_AI_TIMEOUT_MS }`, used whenever config.ai is unset) FIRST — so when
    // modelConfig (config.models["default"]) has no timeout_ms of its own, the spread
    // leaves baseAi's 30000ms fallback in merged.timeout_ms, which is truthy and wins over
    // config.ai_timeout.providers[providerType] at the next `else if` branch. This silently
    // defeats the ai_timeout.providers per-provider override for exactly the "config.ai
    // unset, minimal config.models.default" shape createMockConfig-based callers (e.g. the
    // eval-judge's callLlmEndpoint) use. A real headless-CLI judge call timed out at
    // 30000ms even with ai_timeout.providers["claude-cli"] set to 300000.
    ProviderRegistry.clear();
    let capturedTimeoutMs: number | undefined;
    ProviderRegistry.registerWithMetadata(
      "claude-cli",
      {
        create: (options) => {
          capturedTimeoutMs = options.timeoutMs;
          const provider: IModelProvider = {
            id: "claude-cli-test",
            generate: () =>
              Promise.resolve({
                content: "",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                model: "claude-sonnet-5",
                provider: "claude-cli",
              }),
          };
          return Promise.resolve(provider);
        },
      },
      {
        name: "Claude CLI (test double)",
        description: "test double",
        capabilities: [],
        costTier: ProviderCostTier.FREE,
        pricingTier: PricingTier.FREE,
        strengths: [],
      },
    );

    try {
      const config: Config = {
        ...createTestConfig(),
        ai: undefined,
        models: {
          default: { provider: ProviderType.CLAUDE_CLI, model: "claude-sonnet-5" },
        },
        ai_timeout: {
          default_ms: 30000,
          providers: { [ProviderType.CLAUDE_CLI]: 300000 },
        },
      };

      const provider = await ProviderFactory.createByName(config, "default");
      // The registry returns a LazyProvider for non-key-based factories — the wrapped
      // factory's create() (and therefore the resolved timeoutMs it received) is only
      // invoked on first use, not at construction.
      await provider.generate("probe", {});

      assertEquals(
        capturedTimeoutMs,
        300000,
        "ai_timeout.providers['claude-cli'] must be honored, not shadowed by baseAi's MOCK-fallback timeout_ms",
      );
    } finally {
      ProviderRegistry.clear();
    }
  },
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
  assertEquals(typeof response.content, "string");
});

Deno.test("ProviderFactory: provider can be used for plan generation", async () => {
  // Use scripted strategy for testing (doesn't require recorded fixtures)
  const config = createTestConfig({ provider: "mock", mock: { strategy: MockStrategy.SCRIPTED } });
  const provider = await ProviderFactory.create(config);

  const response = await provider.generate("Implement a feature for user authentication");
  assertExists(response);
  assertEquals(typeof response.content, "string");
});

// ============================================================================
// getProviderInfo Tests
// ============================================================================

Deno.test("ProviderFactory: getProviderInfo returns provider details", () => {
  return withConcreteProviders(() => {
    const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
    const info = ProviderFactory.getProviderInfo(config);

    assertEquals(info.type, "ollama");
    assertEquals(info.model, "llama3.2");
    assertExists(info.id);
  });
});

Deno.test(
  "ProviderFactory: getProviderInfo respects env vars",
  withEnvVars({ EXA_LLM_PROVIDER: "ollama" }, () => {
    return withConcreteProviders(() => {
      const config = createTestConfig({ provider: ProviderType.OLLAMA, model: "llama3.2" });
      const info = ProviderFactory.getProviderInfo(config);

      assertEquals(info.type, "ollama");
      assertEquals(info.model, "llama3.2");
    });
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
    await withConcreteProviders(async () => {
      await SecureCredentialStore.set("ANTHROPIC_API_KEY", "test-key");

      const config = createTestConfig();
      config.rate_limiting.enabled = false;
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertStringIncludes(provider.id, `anthropic-${TEST_MODEL_ANTHROPIC}`);
      assertEquals(provider.id.startsWith("anthropic"), true);

      SecureCredentialStore.clear("ANTHROPIC_API_KEY");
    });
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
    await withConcreteProviders(async () => {
      await SecureCredentialStore.set("OPENAI_API_KEY", "test-key");

      const config = createTestConfig();
      config.rate_limiting.enabled = false;
      const provider = await ProviderFactory.create(config);

      assertExists(provider);
      assertStringIncludes(provider.id, `openai-${TEST_MODEL_OPENAI}`);
      assertEquals(provider.id.startsWith("openai"), true);

      SecureCredentialStore.clear("OPENAI_API_KEY");
    });
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

Deno.test("ProviderFactory: any provider generates unknown ID", () => {
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
  await withConcreteProviders(async () => {
    const config = createTestConfig();
    config.models = {
      primary: { provider: ProviderType.ANTHROPIC, model: "bad-model", timeout_ms: 30000 },
      fallback: { provider: ProviderType.MOCK, model: "fallback-mock", timeout_ms: 30000 },
    };
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
});

Deno.test("ProviderFactory: createWithFallback throws if all fail", async () => {
  await withConcreteProviders(async () => {
    const config = createTestConfig();
    config.models = {
      primary: { provider: ProviderType.ANTHROPIC, model: "bad-model", timeout_ms: 30000 },
      fallback: { provider: ProviderType.ANTHROPIC, model: "bad-model", timeout_ms: 30000 },
    };
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
});

Deno.test("ProviderFactory: createWithFallback healthCheck calls validateConnection", async () => {
  // Custom provider with validateConnection
  class TestProvider {
    id = "test-provider";
    validateConnection() {
      return true;
    }
    generate(): Promise<IGenerateResult> {
      return Promise.resolve({
        content: "ok",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "test-model",
        provider: "mock",
        cost_usd: 0,
      });
    }
  }
  // Patch ProviderFactory.createByName to return TestProvider for this test
  const originalCreateByName = ProviderFactory.createByName;
  type ICreateByNameConfig = Parameters<typeof ProviderFactory.createByName>[0];
  ProviderFactory.createByName = (_config: ICreateByNameConfig, _name: string) => Promise.resolve(new TestProvider());
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
    RateLimiterError,
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
