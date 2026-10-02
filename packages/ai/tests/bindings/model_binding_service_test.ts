/**
 * @module ModelBindingServiceTest
 * @path packages/ai/tests/bindings/model_binding_service_test.ts
 * @description Drives a self-hosted service with its own key variable through ModelBindingService: it validates,
 *   constructs the real openai-chat provider, sends that service's key, and a rotated key builds a fresh provider.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/schemas, @exaix/testing]
 * @related-files [packages/ai/src/bindings/model_binding_service.ts, packages/ai-openai/src/compatible_factory.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ModelBindingService, ProviderRegistry } from "@exaix/ai";
import { type Config, FlowSchema } from "@exaix/schemas";
import { createMockConfig, createMockEventLogger, initTestDbService, withEnv } from "@exaix/testing";
import { bootstrapProviderRegistry } from "../../../../apps/common/registry_bootstrap.ts";

const SERVICE_KEY_ENV = "LITELLM_PROXY_KEY";
const SERVICE_MODEL = "llama3.1:8b";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "One self-hosted step",
  steps: [{ id: "compose", name: "Compose", agent_role: "composer" }],
  output: { from: "compose" },
});
const composeRef = {
  flowId: "research",
  stepId: "compose",
  agentRole: "composer",
  kind: "agent",
  nativeTools: false,
} as const;

/** A loopback Chat Completions fixture that records each request's Authorization header. */
function startFixture() {
  const authorization: Array<string | null> = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (request) => {
    authorization.push(request.headers.get("Authorization"));
    return Response.json({
      model: SERVICE_MODEL,
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });
  });
  const port = (server.addr as Deno.NetAddr).port;
  return { endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, authorization, shutdown: () => server.shutdown() };
}

function selfHostedConfig(tempDir: string, endpoint: string): Config {
  return createMockConfig(tempDir, {
    ai: { provider: "mock", model: "boot" },
    catalog: {
      models: { "meta/llama3.1:8b": { model_provider: "meta" } },
      services: {
        "litellm-proxy": {
          adapter: "openai-chat",
          profile: "self-hosted",
          endpoint,
          allow_insecure_loopback: true,
          transport: "local",
          interface: "api",
          key_env: SERVICE_KEY_ENV,
          serves: { "meta/llama3.1:8b": SERVICE_MODEL },
        },
      },
      preferences: {},
    },
    bindings: { "flow:research/step:compose": { service: "litellm-proxy", model: "meta/llama3.1:8b" } },
  });
}

Deno.test("[security] a per-service self-hosted key validates and constructs through ModelBindingService", async () => {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
  const { db, tempDir, cleanup } = await initTestDbService();
  const fixture = startFixture();
  try {
    const config = selfHostedConfig(tempDir, fixture.endpoint);
    let version = "v1";
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      adapterKeyEnv: { "openai-chat|self-hosted": "EXA_COMPAT_SELF_HOSTED_API_KEY" },
      probe: {
        hasKey: (name) => Deno.env.get(name) !== undefined,
        hasOptIn: () => true,
        keyVersion: () => Promise.resolve(version),
      },
    });
    const generateOnce = async (): Promise<unknown> => {
      const run = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
      const target = await service.providerFor(run, composeRef);
      assert(target?.kind === "provider", "the self-hosted step must resolve to a provider");
      await target.provider.generate("prompt");
      await service.releaseRun(run.traceId);
      return target.provider;
    };

    await withEnv({ [SERVICE_KEY_ENV]: "key-v1", EXA_COMPAT_SELF_HOSTED_API_KEY: "shared-key" }, async () => {
      const first = await generateOnce();
      assertEquals(fixture.authorization, ["Bearer key-v1"]);

      version = "v2";
      await withEnv({ [SERVICE_KEY_ENV]: "key-v2" }, async () => {
        const rotated = await generateOnce();
        assertEquals(fixture.authorization, ["Bearer key-v1", "Bearer key-v2"]);
        assert(rotated !== first, "a rotated key must build a fresh pooled provider");
      });
    });
  } finally {
    await fixture.shutdown();
    await cleanup();
  }
});
