/**
 * @module OllamaChatLiveTest
 * @path tests/integration/ollama_chat_live_test.ts
 * @description Opt-in live check of the built-in ollama-chat service. When the `live-ollama-chat` preset holds (EXA_MATRIX_OLLAMA is set) it builds the
 *   service from the real built-in catalog and makes one call to the local Ollama server.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/model-registry, @exaix/schemas]
 * @related-files [packages/model-registry/src/binding_catalog.ts, packages/ai-openai/src/compatible_factory.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ProviderFactory, ProviderRegistry } from "@exaix/ai";
import { buildBuiltInCatalog } from "@exaix/model-registry";
import { ConfigSchema } from "@exaix/schemas";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";
import { liveSkipReason } from "../helpers/live_presets.ts";

/** The local model to call. It must already be pulled into the Ollama server. */
const OLLAMA_MODEL_ENV = "EXA_MATRIX_OLLAMA_MODEL";
const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";
const OLLAMA_CHAT_SERVICE = "ollama-chat";

/** An opted-in run expects a working server, so a missing server or model fails with the step that fixes it. */
async function assertOllamaServes(origin: string, model: string): Promise<void> {
  let tags: { models?: Array<{ name: string }> };
  try {
    tags = await (await fetch(`${origin}/api/tags`)).json();
  } catch {
    throw new Error(`Ollama is not reachable at ${origin}: start it with 'ollama serve'`);
  }
  if (!(tags.models ?? []).some((entry) => entry.name === model)) {
    throw new Error(`The model ${model} is not pulled into Ollama: run 'ollama pull ${model}'`);
  }
}

Deno.test({
  name: "[phase203.live] ollama-chat answers one call when its live preset holds",
  ignore: liveSkipReason(OLLAMA_CHAT_SERVICE) !== null,
  async fn() {
    ProviderRegistry.clear();
    bootstrapProviderRegistry();
    const service = buildBuiltInCatalog().services[OLLAMA_CHAT_SERVICE];
    const model = Deno.env.get(OLLAMA_MODEL_ENV) ?? DEFAULT_OLLAMA_MODEL;
    await assertOllamaServes(new URL(service.endpoint!).origin, model);
    const config = ConfigSchema.parse({ system: {}, paths: {}, ai: { provider: "mock", model: "boot-model" } });

    const provider = await ProviderFactory.createFromBinding(config, {
      service: OLLAMA_CHAT_SERVICE,
      model_provider: "meta",
      model: `meta/${model}`,
      service_model_id: model,
      transport: service.transport,
      interface: service.interface,
      adapter: service.adapter,
      profile: service.profile,
      endpoint: service.endpoint,
      allow_insecure_loopback: service.allow_insecure_loopback,
      supports_tool_choice: service.supports_tool_choice,
      sources: {},
      fingerprint: "0".repeat(64),
    });
    const result = await provider.generate("Reply with the single word: ready");

    assert(result.content.length > 0, "the local Ollama returned no content");
    assertEquals(result.costStatus, "unknown");
  },
});
