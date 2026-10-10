/**
 * @module LlmBindingsTest
 * @path tests/integration/llm_bindings_test.ts
 * @description Proves the test-side LLM binding helper. Each preset resolves through the phase-204
 *   binding resolver to the adapter the built-in catalog declares, and its provider is built by
 *   ProviderFactory.createFromBinding. EXA_TEST_BIND overrides the live binding in --bind syntax.
 *   A missing key or an unknown service fails before any provider call.
 * @architectural-layer Test
 * @related-files [
 *   "tests/helpers/llm_bindings.ts",
 *   "packages/ai/src/bindings/binding_resolver.ts",
 *   "packages/model-registry/src/binding_catalog.ts"
 * ]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { withEnv } from "@exaix/testing";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import {
  createLlmProvider,
  EXA_TEST_BIND_ENV,
  liveLlmSpec,
  liveReplayLlmSpec,
  LLM_TEST_PRESETS,
  llmKeyEnv,
  resolveLlmBinding,
} from "../helpers/llm_bindings.ts";

/** The adapter each preset must resolve to. The catalog owns the mapping. This table pins it. */
const EXPECTED_ADAPTER: Record<string, string> = {
  google: "google",
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  deepseek: "openai-chat",
};

Deno.test("[llm_bindings] every preset resolves through the catalog to its adapter", async () => {
  for (const preset of LLM_TEST_PRESETS) {
    const keyEnv = llmKeyEnv(preset.spec);
    assertEquals(keyEnv !== undefined, true, `${preset.id} must name its key variable in the catalog`);
    await withEnv({ [keyEnv!]: "test-key" }, () => {
      const binding = resolveLlmBinding(preset.spec);
      assertEquals(binding.adapter, EXPECTED_ADAPTER[preset.id], `${preset.id} adapter`);
      assertEquals(binding.service, preset.spec.service, `${preset.id} service`);
    });
  }
});

Deno.test("[llm_bindings] the DeepSeek preset binds the openai-chat deepseek profile at its pinned model", async () => {
  await withEnv({ DEEPSEEK_API_KEY: "test-key" }, () => {
    const binding = resolveLlmBinding({ service: "deepseek", service_model_id: "deepseek-v4-pro" });
    assertEquals(binding.profile, "deepseek");
    assertEquals(binding.service_model_id, "deepseek-v4-pro");
    assertEquals(binding.endpoint, "https://api.deepseek.com/v1/chat/completions");
  });
});

Deno.test("[llm_bindings] a missing key fails the binding before any provider is built", async () => {
  await withEnv({ ANTHROPIC_API_KEY: null }, () => {
    assertThrows(
      () => resolveLlmBinding({ service: "anthropic", service_model_id: "claude-haiku-4-5-20251001" }),
      Error,
      "key_missing",
    );
  });
});

Deno.test("[llm_bindings] an unknown service fails the binding", () => {
  assertThrows(
    () => resolveLlmBinding({ service: "no-such-service", service_model_id: "any-model" }),
    Error,
  );
});

Deno.test("[llm_bindings] EXA_TEST_BIND overrides the live binding in --bind syntax", async () => {
  await withEnv({ [EXA_TEST_BIND_ENV]: "default=service=openai,service_model_id=gpt-5-mini" }, () => {
    assertEquals(liveLlmSpec(), { service: "openai", service_model_id: "gpt-5-mini" });
  });
});

Deno.test("[llm_bindings] without EXA_TEST_BIND the live binding is the DeepSeek preset", async () => {
  await withEnv({ [EXA_TEST_BIND_ENV]: null }, () => {
    assertEquals(liveLlmSpec().service, "deepseek");
  });
});

Deno.test("[llm_bindings] the grouped-replay live default pins gemini-3-flash, not a latest alias", async () => {
  await withEnv({ [EXA_TEST_BIND_ENV]: null }, () => {
    assertEquals(liveReplayLlmSpec(), { service: "google", service_model_id: "gemini-3-flash" });
  });
});

Deno.test("[llm_bindings] each preset's grouped-replay flag matches its boot registration", async () => {
  bootstrapProviderRegistry();
  try {
    for (const preset of LLM_TEST_PRESETS) {
      const keyEnv = llmKeyEnv(preset.spec)!;
      await withEnv({ [keyEnv]: "test-key" }, async () => {
        const { provider } = await createLlmProvider(preset.spec);
        const flag = ProviderRegistry.getMetadataForInstance(provider.id)?.supportsParallelToolReplay === true;
        assertEquals(flag, preset.groupedReplay, `${preset.id} grouped-replay flag`);
      });
    }
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[llm_bindings] a CLI service is refused for a test step, because the resolver binds CLI only to judges and delegates", () => {
  assertThrows(
    () => resolveLlmBinding({ service: "claude-cli", service_model_id: "claude-sonnet-5" }),
    Error,
    "interface_unsupported",
  );
});
