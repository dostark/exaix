/**
 * @module OpenRouterAdapterWiringTest
 * @path tests/integration/openrouter_adapter_wiring_test.ts
 * @description Drives the OpenRouter provider through the production path: ProviderFactory builds it
 * from a parsed config, wraps it in TracedProvider with a real EventLogger, and the failure lands in
 * the real activity journal with the typed error class.
 * @architectural-layer Integration
 * @dependencies [@exaix/ai, @exaix/ai-openrouter, @exaix/core, @exaix/testing]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/ai/src/provider_factory.ts, packages/ai/src/traced_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { PricingTier } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { Config } from "@exaix/schemas";
import { createMockConfig, initTestDbService, withEnv } from "@exaix/testing";
import { OPENROUTER_PROVIDER_METADATA, OpenRouterProviderFactory, PROVIDER_OPENROUTER } from "@exaix/ai-openrouter";
import { ProviderFactory, setProviderRegistryBootstrap } from "@exaix/ai/provider_factory.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";

const OPENROUTER_MODEL = "qwen/qwen3.7-flash";

function registerOpenRouter(): void {
  ProviderRegistry.clear();
  setProviderRegistryBootstrap(() => {
    if (ProviderRegistry.getSupportedProviders().includes(PROVIDER_OPENROUTER)) return;
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENROUTER, new OpenRouterProviderFactory(), {
      ...OPENROUTER_PROVIDER_METADATA,
      capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
      strengths: [...OPENROUTER_PROVIDER_METADATA.strengths],
      pricingTier: PricingTier.MEDIUM,
    });
  });
}

function openRouterConfig(root: string): Config {
  return createMockConfig(root, { ai: { provider: PROVIDER_OPENROUTER, model: OPENROUTER_MODEL } } as Partial<Config>);
}

interface IFailedPayload {
  error_type?: string;
  error?: string;
}

Deno.test({
  name:
    "[integration] a ProviderFactory-built OpenRouter provider journals llm.call.failed with error_type OpenRouterRoutingError for a stubbed routing 404",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, tempDir, cleanup } = await initTestDbService();
    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: "No endpoints found that can handle the requested parameters.",
              metadata: { provider_name: "Alibaba" },
            },
          }),
          { status: 404 },
        ),
      );
    }) as typeof fetch;
    registerOpenRouter();
    try {
      await withEnv(
        {
          OPENROUTER_API_KEY: "sk-or-test",
          EXA_TEST_ENABLE_PAID_LLM: "1",
          EXA_LLM_PROVIDER: null,
          EXA_LLM_MODEL: null,
          EXA_LLM_BASE_URL: null,
          EXA_LLM_ENDPOINT: null,
        },
        async () => {
          const logger = new EventLogger({ db });
          const provider = await ProviderFactory.create(openRouterConfig(tempDir), db, logger);
          const traceId = crypto.randomUUID();
          let thrown: Error | undefined;
          try {
            await provider.generate("hi", { traceId });
          } catch (error) {
            thrown = error as Error;
          }
          assertEquals(thrown?.name, "OpenRouterRoutingError");
          assertEquals(fetchCalls, 1);

          await db.waitForFlush();
          const events = await db.getActivitiesByTraceSafe(traceId);
          const failed = events.find((event) => event.action_type === DomainEventType.LlmCallFailed);
          if (!failed) throw new Error("llm.call.failed was not journaled");
          const payload = JSON.parse(failed.payload ?? "{}") as IFailedPayload;
          assertEquals(payload.error_type, "OpenRouterRoutingError");
          assertEquals(payload.error?.includes("provider=Alibaba"), true);
        },
      );
    } finally {
      setProviderRegistryBootstrap(undefined);
      ProviderRegistry.clear();
      globalThis.fetch = origFetch;
      await cleanup();
    }
  },
});
