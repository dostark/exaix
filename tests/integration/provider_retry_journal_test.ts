/**
 * @module ProviderRetryJournalTest
 * @path tests/integration/provider_retry_journal_test.ts
 * @description A ProviderFactory-built OpenRouter provider that retries a 503 journals one provider.retry.scheduled
 *   row under the request's trace id, through the real EventLogger and the real activity journal. The configured
 *   ai_retry values (retry_after_max_ms and the per-provider attempt count) reach the retry loop.
 * @architectural-layer Integration
 * @dependencies [@exaix/ai, @exaix/ai-openrouter, @exaix/core, @exaix/testing]
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai-openrouter/src/openrouter_provider.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { PricingTier } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { Config } from "@exaix/schemas";
import { createMockConfig, initTestDbService, withEnv } from "@exaix/testing";
import type { IDatabaseService } from "@exaix/core/types";
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
  retry_after_ms?: number;
}

const RETRY_AFTER_HEADER_SECONDS = "30";
const CONFIGURED_CAP_MS = 1_000;
const CONFIGURED_ATTEMPTS = 2;
const RATE_LIMIT_BODY = JSON.stringify({ error: { message: "Rate limit exceeded", code: 429 } });

interface IRetryHarness {
  db: IDatabaseService;
  logger: EventLogger;
  config: Config;
  calls: () => number;
}

type FetchReply = (call: number) => Response;

/** Builds the real registry, journal and config around a faked OpenRouter transport, then runs `body`. */
async function withOpenRouterFactory(
  reply: FetchReply,
  aiRetry: Config["ai_retry"] | undefined,
  body: (harness: IRetryHarness) => Promise<void>,
  makeLogger: (db: IDatabaseService) => EventLogger = (db) => new EventLogger({ db }),
): Promise<void> {
  const { db, tempDir, cleanup } = await initTestDbService();
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    if (String(input).endsWith("/models")) return Promise.resolve(new Response('{"data":[]}', { status: 200 }));
    calls++;
    return Promise.resolve(reply(calls));
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
        const config = createMockConfig(tempDir, {
          ai: { provider: PROVIDER_OPENROUTER, model: OPENROUTER_MODEL },
          ...(aiRetry ? { ai_retry: aiRetry } : {}),
        } as Partial<Config>);
        await body({ db, logger: makeLogger(db), config, calls: () => calls });
      },
    );
  } finally {
    setProviderRegistryBootstrap(undefined);
    ProviderRegistry.clear();
    globalThis.fetch = origFetch;
    await cleanup();
  }
}

async function retryRows(db: IDatabaseService, traceId: string) {
  await db.waitForFlush();
  return (await db.getActivitiesByTraceSafe(traceId)).filter((row) =>
    row.action_type === DomainEventType.ProviderRetryScheduled
  );
}

/** A real EventLogger that aborts the request once a retry is journaled, so no test waits out the delay. */
class AbortOnRetryLogger extends EventLogger {
  constructor(db: IDatabaseService, private readonly controller: AbortController) {
    super({ db });
  }

  override async warn(
    ...args: Parameters<EventLogger["warn"]>
  ): ReturnType<EventLogger["warn"]> {
    const result = await super.warn(...args);
    if (args[0] === DomainEventType.ProviderRetryScheduled) this.controller.abort();
    return result;
  }
}

const OK_REPLY = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });

Deno.test({
  name: "[integration] a retried 503 journals one provider.retry.scheduled row under the request trace id",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withOpenRouterFactory(
      (call) => call === 1 ? new Response("{}", { status: 503 }) : OK_REPLY(),
      undefined,
      async ({ db, logger, config, calls }) => {
        const provider = await ProviderFactory.create(config, db, logger);
        const traceId = crypto.randomUUID();
        const result = await provider.generate("hi", { traceId });
        assertEquals(result.content, "ok");
        assertEquals(calls(), 2);

        const rows = await retryRows(db, traceId);
        assertEquals(rows.length, 1);
        const payload = JSON.parse(rows[0].payload ?? "{}") as IRetryPayload;
        assertEquals(payload.attempt, 1);
        assertEquals(payload.error_type, "ConnectionError");
        assertEquals(typeof payload.delay_ms, "number");
        assertEquals(typeof payload.max_attempts, "number");
      },
    );
  },
});

Deno.test({
  name:
    "[integration] a configured ai_retry.retry_after_max_ms caps the journaled delay of a 429 with a longer Retry-After",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const controller = new AbortController();
    await withOpenRouterFactory(
      () => new Response(RATE_LIMIT_BODY, { status: 429, headers: { "Retry-After": RETRY_AFTER_HEADER_SECONDS } }),
      { max_attempts: 3, backoff_base_ms: 100, timeout_per_request_ms: 30_000, retry_after_max_ms: CONFIGURED_CAP_MS },
      async ({ db, logger, config }) => {
        const provider = await ProviderFactory.create(config, db, logger);
        const traceId = crypto.randomUUID();
        await assertRejects(
          () => provider.generate("hi", { traceId, requestSignal: controller.signal }),
          DOMException,
        );
        const rows = await retryRows(db, traceId);
        assertEquals(rows.length, 1);
        const payload = JSON.parse(rows[0].payload ?? "{}") as IRetryPayload;
        assertEquals(payload.retry_after_ms, Number(RETRY_AFTER_HEADER_SECONDS) * 1000);
        assertEquals(payload.delay_ms, CONFIGURED_CAP_MS);
      },
      (db) => new AbortOnRetryLogger(db, controller),
    );
  },
});

Deno.test({
  name: "[integration] ai_retry.providers.openrouter.max_attempts sets the HTTP call count of a sustained 503",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await withOpenRouterFactory(
      () => new Response("{}", { status: 503 }),
      {
        max_attempts: 3,
        backoff_base_ms: 100,
        timeout_per_request_ms: 30_000,
        retry_after_max_ms: CONFIGURED_CAP_MS,
        providers: { [PROVIDER_OPENROUTER]: { max_attempts: CONFIGURED_ATTEMPTS, backoff_base_ms: 100 } },
      },
      async ({ db, logger, config, calls }) => {
        const provider = await ProviderFactory.create(config, db, logger);
        await assertRejects(() => provider.generate("hi", { traceId: crypto.randomUUID() }));
        assertEquals(calls(), CONFIGURED_ATTEMPTS);
      },
    );
  },
});
