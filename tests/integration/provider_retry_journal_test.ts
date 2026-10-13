/**
 * @module ProviderRetryJournalTest
 * @path tests/integration/provider_retry_journal_test.ts
 * @description A ProviderFactory-built OpenRouter provider that retries a 503 journals one provider.retry.scheduled
 *   row under the request's trace id, through the real EventLogger and the real activity journal.
 * @architectural-layer Integration
 * @dependencies [@exaix/ai, @exaix/ai-openrouter, @exaix/core, @exaix/testing]
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai-openrouter/src/openrouter_provider.ts]
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

const OPENROUTER_MODEL = "openai/gpt-4";

interface IRetryPayload {
  provider?: string;
  attempt?: number;
  max_attempts?: number;
  delay_ms?: number;
  error_type?: string;
}

Deno.test({
  name: "[integration] a retried 503 journals one provider.retry.scheduled row under the request trace id",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, tempDir, cleanup } = await initTestDbService();
    const origFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((input: string | URL | Request) => {
      if (String(input).endsWith("/models")) return Promise.resolve(new Response('{"data":[]}', { status: 200 }));
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response("{}", { status: 503 })
          : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
      );
    }) as typeof fetch;
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
    try {
      await withEnv(
        {
          OPENROUTER_API_KEY: "sk-or-test",
          EXA_LLM_PROVIDER: null,
          EXA_LLM_MODEL: null,
          EXA_LLM_BASE_URL: null,
          EXA_LLM_ENDPOINT: null,
        },
        async () => {
          const logger = new EventLogger({ db });
          const config = createMockConfig(tempDir, {
            ai: { provider: PROVIDER_OPENROUTER, model: OPENROUTER_MODEL },
          } as Partial<Config>);
          const provider = await ProviderFactory.create(config, db, logger);
          const traceId = crypto.randomUUID();
          const result = await provider.generate("hi", { traceId });
          assertEquals(result.content, "ok");
          assertEquals(calls, 2);

          await db.waitForFlush();
          const rows = (await db.getActivitiesByTraceSafe(traceId)).filter((row) =>
            row.action_type === DomainEventType.ProviderRetryScheduled
          );
          assertEquals(rows.length, 1);
          const payload = JSON.parse(rows[0].payload ?? "{}") as IRetryPayload;
          assertEquals(payload.attempt, 1);
          assertEquals(payload.error_type, "ConnectionError");
          assertEquals(typeof payload.delay_ms, "number");
          assertEquals(typeof payload.max_attempts, "number");
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
