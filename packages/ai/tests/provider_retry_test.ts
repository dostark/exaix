/**
 * @module ProviderRetryTest
 * @path packages/ai/tests/provider_retry_test.ts
 * @description The shared fetch layer owns provider retries. A transport failure becomes a typed connection error.
 *   Each scheduled retry is journaled with its trace id, and the call count is exact.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai/src/providers/common.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { performProviderCall } from "../src/provider_common_utils.ts";
import { ConnectionError } from "../src/providers/common.ts";

const URL_UNDER_TEST = "https://provider.test/v1/chat";
const OK_BODY = JSON.stringify({ choices: [{ message: { content: "done" } }] });
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1;

async function withFetch<T>(
  respond: (call: number) => Promise<Response>,
  body: () => Promise<T>,
): Promise<{ calls: number; value: T }> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => respond(++calls)) as typeof fetch;
  try {
    const value = await body();
    return { calls, value };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("a fetch TypeError becomes ConnectionError and is retried", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    calls++;
    return Promise.reject(new TypeError("fetch failed"));
  }) as typeof fetch;
  try {
    const error = await assertRejects(
      () =>
        performProviderCall(URL_UNDER_TEST, { method: "POST", body: "{}" }, {
          id: "p",
          maxAttempts: MAX_ATTEMPTS,
          backoffBaseMs: BACKOFF_MS,
        }),
      ConnectionError,
    );
    assert(error instanceof ConnectionError);
    assertEquals(calls, MAX_ATTEMPTS);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("a sustained 503 makes exactly maxAttempts calls", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response("{}", { status: 503 }));
  }) as typeof fetch;
  try {
    await assertRejects(
      () =>
        performProviderCall(URL_UNDER_TEST, { method: "POST", body: "{}" }, {
          id: "p",
          maxAttempts: MAX_ATTEMPTS,
          backoffBaseMs: BACKOFF_MS,
        }),
      ConnectionError,
    );
    assertEquals(calls, MAX_ATTEMPTS);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("each scheduled retry is journaled as provider.retry.scheduled with the trace id", async () => {
  const logger = createMockEventLogger();
  const traceId = crypto.randomUUID();
  const { calls, value } = await withFetch(
    (call) => Promise.resolve(call === 1 ? new Response("{}", { status: 503 }) : new Response(OK_BODY)),
    () =>
      performProviderCall(URL_UNDER_TEST, { method: "POST", body: "{}" }, {
        id: "p",
        maxAttempts: MAX_ATTEMPTS,
        backoffBaseMs: BACKOFF_MS,
        logger,
        traceId,
      }),
  );
  assertEquals(calls, 2);
  assertEquals(value.content, "done");
  const retries = logger.events.filter((event) => event.action === DomainEventType.ProviderRetryScheduled);
  assertEquals(retries.length, 1);
  assertEquals(retries[0].traceId, traceId);
  assertEquals(retries[0].payload?.provider, "p");
  assertEquals(retries[0].payload?.attempt, 1);
  assertEquals(retries[0].payload?.max_attempts, MAX_ATTEMPTS);
  assertEquals(retries[0].payload?.error_type, "ConnectionError");
  assertEquals(typeof retries[0].payload?.delay_ms, "number");
});

Deno.test("a call that succeeds first time journals no retry", async () => {
  const logger = createMockEventLogger();
  await withFetch(
    () => Promise.resolve(new Response(OK_BODY)),
    () =>
      performProviderCall(URL_UNDER_TEST, { method: "POST", body: "{}" }, {
        id: "p",
        maxAttempts: MAX_ATTEMPTS,
        backoffBaseMs: BACKOFF_MS,
        logger,
      }),
  );
  assertEquals(logger.events.filter((event) => event.action === DomainEventType.ProviderRetryScheduled), []);
});
