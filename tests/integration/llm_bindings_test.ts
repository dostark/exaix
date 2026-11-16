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

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { ENV_TEST_ENABLE_PAID_LLM, withEnv } from "@exaix/testing";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import {
  createLlmProvider,
  EXA_TEST_BIND_ENV,
  liveLlmSkipReason,
  liveLlmSpec,
  liveReplayLlmSpec,
  LLM_TEST_PRESETS,
  llmKeyEnv,
  resolveLlmBinding,
} from "../helpers/llm_bindings.ts";

const OPENCODE_GO_KEY_ENV = "OPENCODE_API_KEY";
const OPENCODE_GO_ENDPOINT = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const OPENCODE_GO_MODEL = "deepseek-v4.1-flash";

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
      () => resolveLlmBinding({ service: "anthropic", service_model_id: "claude-haiku-5-5" }),
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

Deno.test("[llm_bindings] the grouped-replay live default is the DeepSeek preset", async () => {
  await withEnv({ [EXA_TEST_BIND_ENV]: null }, () => {
    assertEquals(liveReplayLlmSpec(), { service: "deepseek", service_model_id: "deepseek-v4-pro" });
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

Deno.test("[llm_bindings] a CLI service binds as a generate provider with its cli interface", () => {
  const binding = resolveLlmBinding({ service: "codex-cli", service_model_id: "gpt-5.6-terra" });
  assertEquals(binding.adapter, "codex-cli");
  assertEquals(binding.interface, "cli");
  assertEquals(binding.service_model_id, "gpt-5.6-terra");
});

Deno.test("[llm_bindings] a cli-delegate service is still refused, because it is a session tool and no provider", () => {
  assertThrows(
    () => resolveLlmBinding({ service: "codex", service_model_id: "gpt-5.6-terra" }),
    Error,
    "a judge uses provider.generate",
  );
});

Deno.test("[llm_bindings] the Codex CLI live gate needs its opt-in and the binary, and no key", async () => {
  await withEnv({ EXA_MATRIX_CODEX_CLI: null }, () => {
    assertStringIncludes(liveLlmSkipReason({ service: "codex-cli" }) ?? "", "EXA_MATRIX_CODEX_CLI");
  });
  assertEquals(llmKeyEnv({ service: "codex-cli" }), undefined);
});

Deno.test("[llm_bindings] the OpenCode Go preset binds DeepSeek V4.1 Flash at the OpenCode Go endpoint with its own key", async () => {
  await withEnv({ [OPENCODE_GO_KEY_ENV]: "test-key" }, () => {
    const spec = liveLlmSpec("opencode-go");
    assertEquals(spec, { service: "opencode-go", service_model_id: OPENCODE_GO_MODEL });
    const binding = resolveLlmBinding(spec);
    assertEquals(binding.adapter, "openai-chat");
    assertEquals(binding.profile, "self-hosted");
    assertEquals(binding.endpoint, OPENCODE_GO_ENDPOINT);
    assertEquals(binding.service_model_id, OPENCODE_GO_MODEL);
    assertEquals(binding.key_env, OPENCODE_GO_KEY_ENV);
    assertEquals(binding.headers, { "x-opencode-session": "{session_id}", "user-agent": "exaix-live-tests/1.0" });
  });
});

Deno.test("[llm_bindings] EXA_TEST_BIND still overrides a requested preset", async () => {
  await withEnv({ [EXA_TEST_BIND_ENV]: "default=service=openai,service_model_id=gpt-5-mini" }, () => {
    assertEquals(liveLlmSpec("opencode-go"), { service: "openai", service_model_id: "gpt-5-mini" });
  });
});

Deno.test("[llm_bindings] the live gate follows the service that EXA_TEST_BIND binds", async () => {
  await withEnv(
    {
      [EXA_TEST_BIND_ENV]: "default=service=openai,service_model_id=gpt-5-mini",
      [ENV_TEST_ENABLE_PAID_LLM]: "1",
      OPENAI_API_KEY: null,
    },
    () => {
      const reason = liveLlmSkipReason(liveLlmSpec("opencode-go")) ?? "";
      assertStringIncludes(reason, "OPENAI_API_KEY");
    },
  );
});
