/**
 * @module ProviderFactoryBindingTest
 * @path packages/ai/tests/provider_factory_binding_test.ts
 * @description Checks binding-specific provider creation and compatible qualification.
 */

import { assertEquals, assertInstanceOf, assertRejects, assertStringIncludes } from "@std/assert";
import { type IBindingLayers, ProviderFactory, ProviderRegistry, resolveBinding } from "@exaix/ai";
import { buildBuiltInCatalog } from "@exaix/model-registry";
import { parse as parseToml } from "@std/toml";
import { z } from "zod";
import { BindingCatalogSchema, BindingsTableSchema, ConfigSchema, type IResolvedBinding } from "@exaix/schemas";
import { withEnv } from "@exaix/testing";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS } from "@exaix/core";
import { bootstrapProviderRegistry } from "../../../apps/common/registry_bootstrap.ts";

const config = ConfigSchema.parse({ system: {}, paths: {}, ai: { provider: "mock", model: "boot-model" } });
const mockBinding: IResolvedBinding = {
  service: "mock",
  model_provider: "mock",
  model: "mock/bound-model",
  service_model_id: "bound-model",
  transport: "local",
  interface: "api",
  adapter: "mock",
  sources: {},
  fingerprint: "a".repeat(64),
};

const SELF_HOSTED_MODEL = "llama3.1:8b";
const SELF_HOSTED_KEY_ENV = "EXA_COMPAT_SELF_HOSTED_API_KEY";

interface ICompatibleFixture {
  endpoint: string;
  authorizationHeaders: Array<string | null>;
  shutdown: () => Promise<void>;
}

/** One loopback fixture that answers a compatible Chat Completions call and records the request. */
function startCompatibleFixture(): ICompatibleFixture {
  const authorizationHeaders: Array<string | null> = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (request) => {
    authorizationHeaders.push(request.headers.get("Authorization"));
    return Response.json({
      model: SELF_HOSTED_MODEL,
      choices: [{ message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
  });
  const port = (server.addr as Deno.NetAddr).port;
  return {
    endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    authorizationHeaders,
    shutdown: () => server.shutdown(),
  };
}

Deno.test("binding factory ignores EXA_LLM_PROVIDER and EXA_LLM_MODEL", async () => {
  await withEnv({ EXA_LLM_PROVIDER: "missing-provider", EXA_LLM_MODEL: "wrong-model" }, async () => {
    const provider = await ProviderFactory.createFromBinding(config, mockBinding);
    assertStringIncludes(provider.id, "bound-model");
  });
});

Deno.test("[phase203.binding] createFromBinding builds a self-hosted provider that generates without Authorization", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  const fixture = startCompatibleFixture();
  try {
    await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
      const provider = await ProviderFactory.createFromBinding(config, {
        ...mockBinding,
        service: "local-gpu",
        model_provider: "openai",
        model: `openai/${SELF_HOSTED_MODEL}`,
        service_model_id: SELF_HOSTED_MODEL,
        adapter: "openai-chat",
        profile: "self-hosted",
        endpoint: fixture.endpoint,
        allow_insecure_loopback: true,
        supports_tool_choice: false,
      });

      assertEquals(provider.id, `openai-chat-${SELF_HOSTED_MODEL}`);
      const result = await provider.generate("prompt");

      assertEquals(result.content, "fixture answer");
      assertEquals(result.costStatus, "unknown");
      assertEquals(fixture.authorizationHeaders, [null]);
    });
  } finally {
    await fixture.shutdown();
  }
});

Deno.test("binding factory rejects unknown compatible profiles and unqualified service models", async () => {
  const compatible: IResolvedBinding = {
    ...mockBinding,
    service: "compat-fixture",
    model_provider: "openai",
    model: "openai/compat-fixture-v1",
    service_model_id: "compat-fixture-v1",
    adapter: "openai-chat",
    profile: "local-test",
    endpoint: "http://127.0.0.1:8765/v1/chat/completions",
  };
  await assertRejects(() => ProviderFactory.createFromBinding(config, { ...compatible, profile: "not-a-profile" }));
  const endpointError = await assertRejects(() =>
    ProviderFactory.createFromBinding(config, {
      ...compatible,
      profile: "openai",
      service_model_id: OPENAI_COMPATIBLE_PROFILE_DEFAULTS.openai.model,
      endpoint: "https://example.com/v1/chat/completions",
    })
  );
  assertInstanceOf(endpointError, Error);
  assertStringIncludes(endpointError.message, "pinned endpoint");
  await assertRejects(() =>
    ProviderFactory.createFromBinding(config, { ...compatible, allow_insecure_loopback: false })
  );
  await assertRejects(() =>
    ProviderFactory.createFromBinding(config, {
      ...compatible,
      service_model_id: "other-model",
      allow_insecure_loopback: true,
    })
  );
});

const OLLAMA_CHAT_SERVICE = "ollama-chat";

/** The one eval cell preset row this file reads. Other rows may hold unresolved sentinels. */
const SplitStrongLocalFileSchema = z.object({
  tool: z.object({
    "split-strong-local": z.object({ bindings: BindingsTableSchema, catalog: BindingCatalogSchema }).loose(),
  }).loose(),
}).loose();

const OLLAMA_MODEL = "meta/llama3.1:8b";

/** The built-in ollama-chat service as a resolved binding, with only the endpoint redirected. */
function builtInOllamaBinding(endpoint: string): IResolvedBinding {
  const service = buildBuiltInCatalog().services[OLLAMA_CHAT_SERVICE];
  return {
    ...mockBinding,
    service: OLLAMA_CHAT_SERVICE,
    model_provider: "meta",
    model: OLLAMA_MODEL,
    service_model_id: SELF_HOSTED_MODEL,
    adapter: service.adapter,
    profile: service.profile,
    endpoint,
    allow_insecure_loopback: service.allow_insecure_loopback,
    supports_tool_choice: service.supports_tool_choice,
  };
}

Deno.test("[phase203.catalog] the built-in ollama-chat service constructs through createFromBinding", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  const fixture = startCompatibleFixture();
  try {
    await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
      const provider = await ProviderFactory.createFromBinding(config, builtInOllamaBinding(fixture.endpoint));
      const result = await provider.generate("prompt");

      assertEquals(result.content, "fixture answer");
      assertEquals(fixture.authorizationHeaders, [null]);
      assertEquals(provider.callCapabilities?.supportsToolChoice, false);
    });
  } finally {
    await fixture.shutdown();
  }
});

Deno.test("[phase203.catalog] split-strong-local's role:web-explorer binding constructs", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  const preset = SplitStrongLocalFileSchema.parse(parseToml(await Deno.readTextFile("configs/eval-cells.toml")))
    .tool["split-strong-local"];
  const presetBindings = preset.bindings;
  const presetCatalog = preset.catalog;
  const builtIn = buildBuiltInCatalog();
  const layers: IBindingLayers = {
    entries: Object.entries(presetBindings).map(([selector, spec]) => ({ layer: "overlay" as const, selector, spec })),
    catalog: { ...builtIn, models: { ...builtIn.models, ...presetCatalog.models } },
    overlaySha256: [],
    operatorLayersPresent: true,
  };
  const outcome = resolveBinding(
    { flowId: "research", stepId: "explore-1", agentRole: "web-explorer", kind: "agent", nativeTools: true },
    {},
    layers,
    { hasKey: () => false, hasOptIn: () => false },
  );

  assertEquals(outcome.kind, "bound");
  if (outcome.kind !== "bound") return;
  assertEquals(outcome.binding.service, OLLAMA_CHAT_SERVICE);
  await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
    const provider = await ProviderFactory.createFromBinding(config, outcome.binding);
    assertEquals(provider.id, `openai-chat-${outcome.binding.service_model_id}`);
  });
});
