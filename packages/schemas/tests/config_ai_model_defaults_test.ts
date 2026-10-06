/**
 * @module ConfigAiModelDefaultsTest
 * @path packages/schemas/tests/config_ai_model_defaults_test.ts
 * @description Regression tests for deriving `[models]` from `[ai]`.
 * An `[ai]`-only config must not dispatch to Google.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/schemas/src/config.ts, packages/schemas/src/ai_config.ts, packages/ai/src/provider_factory.ts]
 */
import { assertEquals } from "@std/assert";
import { ProviderDefaultsRegistry } from "@exaix/core";
import { type Config, ConfigSchema } from "@exaix/schemas";
import type { z } from "zod";

/** Minimal valid config. Only `system` is required, everything else defaults. */
function parse(config: Omit<z.input<typeof ConfigSchema>, "system">): Config {
  return ConfigSchema.parse({ system: {}, ...config });
}

Deno.test("[config.ai-models] an [ai]-only ollama section derives ollama, not Google", () => {
  // The derived model uses the provider's registered default.
  // Register it so the assertion does not depend on the AI package bootstrap.
  ProviderDefaultsRegistry.register("ollama", {
    defaultModel: "llama3.2",
    defaultEndpoint: "http://localhost:11434",
    defaultTimeoutMs: 120000,
    defaultRetryMaxAttempts: 3,
    defaultRetryBackoffMs: 1000,
  });
  try {
    const config = parse({ ai: { provider: "ollama" } });

    assertEquals(config.models.default.provider, "ollama");
    assertEquals(config.models.fast.provider, "ollama");
    assertEquals(config.models.local.provider, "ollama");
    assertEquals(config.models.default.model, "llama3.2");
    assertEquals(config.models.fast.model, "llama3.2");
  } finally {
    ProviderDefaultsRegistry.clear();
  }
});

Deno.test("[config.ai-models] an [ai]-only mock section derives the mock default", () => {
  const config = parse({ ai: { provider: "mock" } });

  assertEquals(config.models.default.provider, "mock");
  assertEquals(config.models.default.model, "mock-model");
  assertEquals(config.models.fast.provider, "mock");
});

Deno.test("[config.ai-models] an explicit [ai] model is carried into the derived default", () => {
  const config = parse({ ai: { provider: "anthropic", model: "claude-sonnet-5" } });

  assertEquals(config.models.default.provider, "anthropic");
  assertEquals(config.models.default.model, "claude-sonnet-5");
  assertEquals(config.models.fast.model, "claude-sonnet-5");
});

Deno.test("[config.ai-models] neither section keeps the historical Google default", () => {
  const config = parse({});

  assertEquals(config.models.default.provider, "google");
  assertEquals(config.models.default.model, "gemini-flash-latest");
  assertEquals(config.models.fast.provider, "google");
});

Deno.test("[config.ai-models] an explicit [models] table always wins over [ai]", () => {
  const config = parse({
    ai: { provider: "ollama" },
    models: { default: { provider: "google", model: "gemini-flash-latest" } },
  });

  assertEquals(config.models.default.provider, "google");
  assertEquals(config.models.default.model, "gemini-flash-latest");
});

Deno.test("[config.ai-models] ai.timeout_ms is inherited by the derived default", () => {
  const config = parse({ ai: { provider: "mock", timeout_ms: 12345 } });

  assertEquals(config.models.default.timeout_ms, 12345);
});
