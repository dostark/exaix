/**
 * @module OpenRouterErrorsTest
 * @path packages/ai-openrouter/tests/openrouter_errors_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_errors.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @description Verifies mapOpenRouterError turns each documented OpenRouter error status and body
 * shape into one typed error, keeps the upstream reason, and never copies verbatim upstream payloads.
 */

import { assert, assertEquals, assertFalse, assertStrictEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import {
  AuthenticationError,
  BillingError,
  ConnectionError,
  isRetryable,
  ModelProviderError,
  ProviderTruncationError,
  RateLimitError,
  TimeoutError,
} from "@exaix/ai/providers";
import {
  OPENROUTER_ERROR_FIELD_MAX_CHARS,
  OPENROUTER_RETRY_AFTER_MAX_MS,
  OpenRouterBillingError,
  OpenRouterGuardrailError,
  OpenRouterRoutingError,
  OpenRouterTruncationError,
} from "@exaix/ai-openrouter";
import { mapOpenRouterError } from "../src/openrouter_errors.ts";

const PROVIDER_ID = "openrouter-test";
const ROUTING_MESSAGE = "No endpoints found that can handle the requested parameters.";
const RAW_SENTINEL = "RAW-UPSTREAM-PAYLOAD-SENTINEL";
const FLAGGED_SENTINEL = "FLAGGED-USER-INPUT-SENTINEL";

Deno.test("OpenRouterBillingError is a BillingError and preserves its message and billing fields", () => {
  const detail = { limitSource: "key_limit", limitUsd: 5, spendUsd: 6, resetsAt: "fixture-reset", scope: "key" };
  const error = new OpenRouterBillingError("fixture billing message", PROVIDER_ID, detail);
  assert(error instanceof BillingError);
  assertEquals(error.name, "OpenRouterBillingError");
  assertEquals(error.message, "fixture billing message");
  assertEquals(error.provider, PROVIDER_ID);
  assertEquals([error.limitSource, error.limitUsd, error.spendUsd, error.resetsAt, error.scope], Object.values(detail));
  assertEquals(isRetryable(error), false);
});

Deno.test("OpenRouterTruncationError is a ProviderTruncationError and preserves its token fields and message", () => {
  const error = new OpenRouterTruncationError(PROVIDER_ID, 1000, 1000);
  assert(error instanceof ProviderTruncationError);
  assertEquals(error.name, "OpenRouterTruncationError");
  assertEquals(error.provider, PROVIDER_ID);
  assertEquals([error.completionTokens, error.reasoningTokens], [1000, 1000]);
  assertEquals(
    error.message,
    "OpenRouter response was cut off at the max_tokens limit with no content " +
      "(finish_reason=length, completion_tokens=1000, reasoning_tokens=1000). Raise max_tokens or lower the reasoning effort.",
  );
  assertEquals(isRetryable(error), false);
});

interface IEnvelopeInput {
  message?: string;
  code?: number;
  metadata?: Record<string, JSONValue>;
}

function envelope(input: IEnvelopeInput): string {
  return JSON.stringify({ error: { code: input.code, message: input.message, metadata: input.metadata } });
}

function map(status: number, body: string, headers: Record<string, string> = {}): Error {
  const fallback = new ModelProviderError("shared fallback", PROVIDER_ID);
  return mapOpenRouterError(status, new Headers(headers), body, fallback);
}

interface IMappingCase {
  label: string;
  status: number;
  body: string;
  expectClass: new (...args: never[]) => Error;
  expectExactName: string;
  retried: boolean;
}

const MAPPING_CASES: IMappingCase[] = [
  {
    label: "400 any",
    status: 400,
    body: envelope({ message: "bad", code: 400 }),
    expectClass: ModelProviderError,
    expectExactName: "ModelProviderError",
    retried: false,
  },
  {
    label: "401 any",
    status: 401,
    body: envelope({ message: "User not found.", code: 401 }),
    expectClass: AuthenticationError,
    expectExactName: "AuthenticationError",
    retried: false,
  },
  {
    label: "402 any",
    status: 402,
    body: envelope({ message: "Insufficient credits", code: 402 }),
    expectClass: OpenRouterBillingError,
    expectExactName: "OpenRouterBillingError",
    retried: false,
  },
  {
    label: "403 with metadata.reasons",
    status: 403,
    body: envelope({ message: "flagged", code: 403, metadata: { reasons: ["violence"] } }),
    expectClass: OpenRouterGuardrailError,
    expectExactName: "OpenRouterGuardrailError",
    retried: false,
  },
  {
    label: "403 with metadata.flagged_input",
    status: 403,
    body: envelope({ message: "flagged", code: 403, metadata: { flagged_input: FLAGGED_SENTINEL } }),
    expectClass: OpenRouterGuardrailError,
    expectExactName: "OpenRouterGuardrailError",
    retried: false,
  },
  {
    label: "403 with metadata.patterns",
    status: 403,
    body: envelope({ message: "blocked", code: 403, metadata: { patterns: ["secret"] } }),
    expectClass: OpenRouterGuardrailError,
    expectExactName: "OpenRouterGuardrailError",
    retried: false,
  },
  {
    label: "403 with metadata.limit_source (spent budget)",
    status: 403,
    body: envelope({ message: "budget", code: 403, metadata: { limit_source: "key_limit", scope: "key" } }),
    expectClass: OpenRouterBillingError,
    expectExactName: "OpenRouterBillingError",
    retried: false,
  },
  {
    label: "403 otherwise",
    status: 403,
    body: envelope({ message: "forbidden", code: 403 }),
    expectClass: AuthenticationError,
    expectExactName: "AuthenticationError",
    retried: false,
  },
  {
    label: "404 routing refusal",
    status: 404,
    body: envelope({ message: ROUTING_MESSAGE, code: 404 }),
    expectClass: OpenRouterRoutingError,
    expectExactName: "OpenRouterRoutingError",
    retried: false,
  },
  {
    label: "404 otherwise",
    status: 404,
    body: envelope({ message: "model not found", code: 404 }),
    expectClass: ModelProviderError,
    expectExactName: "ModelProviderError",
    retried: false,
  },
  {
    label: "408 any",
    status: 408,
    body: envelope({ message: "timed out", code: 408 }),
    expectClass: TimeoutError,
    expectExactName: "TimeoutError",
    retried: true,
  },
  {
    label: "429 any",
    status: 429,
    body: envelope({ message: "slow down", code: 429 }),
    expectClass: RateLimitError,
    expectExactName: "OpenRouterRateLimitError",
    retried: true,
  },
  {
    label: "502 any",
    status: 502,
    body: envelope({ message: "upstream down", code: 502 }),
    expectClass: ConnectionError,
    expectExactName: "ConnectionError",
    retried: true,
  },
  {
    label: "503 with a routing-requirement message (Q10)",
    status: 503,
    body: envelope({ message: ROUTING_MESSAGE, code: 503 }),
    expectClass: ConnectionError,
    expectExactName: "ConnectionError",
    retried: true,
  },
];

Deno.test("mapOpenRouterError maps every documented status and body shape to one class", () => {
  for (const c of MAPPING_CASES) {
    const err = map(c.status, c.body);
    assert(err instanceof c.expectClass, `${c.label}: expected ${c.expectClass.name}, got ${err.name}`);
    assertEquals(err.name, c.expectExactName, c.label);
    assertEquals(isRetryable(err), c.retried, `${c.label}: retryable`);
  }
});

Deno.test("mapOpenRouterError returns the shared fallback for statuses outside the table", () => {
  for (const status of [413, 422, 500, 504]) {
    const fallback = new ModelProviderError(`fallback ${status}`, PROVIDER_ID);
    const err = mapOpenRouterError(status, new Headers(), envelope({ message: "x", code: status }), fallback);
    assertStrictEquals(err, fallback);
  }
});

Deno.test("mapOpenRouterError message names error_type, provider_name and provider_code", () => {
  const err = map(
    400,
    envelope({
      message: "Provider returned error",
      code: 400,
      metadata: { error_type: "invalid_request", provider_name: "DeepInfra", provider_code: 12345 },
    }),
  );
  assertEquals(
    err.message,
    "HTTP 400 invalid_request: Provider returned error (provider=DeepInfra, provider_code=12345)",
  );
});

Deno.test("mapOpenRouterError omits the absent parts of the message", () => {
  assertEquals(
    map(400, envelope({ message: "Provider returned error", metadata: { provider_name: "DeepInfra" } })).message,
    "HTTP 400 Provider returned error (provider=DeepInfra)",
  );
  assertEquals(
    map(400, envelope({ message: "bad", metadata: { error_type: "invalid_request" } })).message,
    "HTTP 400 invalid_request: bad",
  );
  assertEquals(map(400, envelope({ code: 400 })).message, "HTTP 400");
});

Deno.test("mapOpenRouterError never copies metadata.raw into the message or onto the error", () => {
  const err = map(
    400,
    envelope({
      message: "Provider returned error",
      metadata: { provider_name: "DeepInfra", raw: RAW_SENTINEL },
    }),
  );
  assertFalse(err.message.includes(RAW_SENTINEL));
  assertFalse(JSON.stringify(Object.entries(err)).includes(RAW_SENTINEL));
});

Deno.test("mapOpenRouterError never copies flagged_input into the message or onto the error", () => {
  for (
    const err of [
      map(403, envelope({ message: "flagged", metadata: { flagged_input: FLAGGED_SENTINEL, reasons: ["x"] } })),
      map(402, envelope({ message: "pay", metadata: { flagged_input: FLAGGED_SENTINEL } })),
    ]
  ) {
    assertFalse(err.message.includes(FLAGGED_SENTINEL));
    assertFalse(JSON.stringify(Object.entries(err)).includes(FLAGGED_SENTINEL));
  }
});

Deno.test("mapOpenRouterError strips control characters and caps every upstream field", () => {
  const long = "x".repeat(OPENROUTER_ERROR_FIELD_MAX_CHARS + 50);
  const err = map(
    400,
    envelope({
      message: `bad\u0007\nline ${long}`,
      metadata: { provider_name: `Deep\u0000Infra${long}`, error_type: `invalid\u001b_request` },
    }),
  );
  assertFalse(/\p{Cc}/u.test(err.message), "control characters must be stripped");
  assertFalse(err.message.includes("x".repeat(OPENROUTER_ERROR_FIELD_MAX_CHARS + 1)), "each field is capped");
  assert(err.message.includes("x".repeat(20)));
});

Deno.test("402 budget fields are parsed, and the class never depends on remedy_hint", () => {
  const metadata = {
    limit_source: "openrouter_in_flight_budget",
    limit_usd: 10,
    spend_usd: 9.5,
    resets_at: "2026-10-13T00:00:00Z",
    scope: "key",
  };
  const a = map(
    402,
    envelope({ message: "limit", code: 402, metadata: { ...metadata, remedy_hint: "contact support" } }),
  );
  const b = map(
    402,
    envelope({ message: "limit", code: 402, metadata: { ...metadata, remedy_hint: "raise the limit" } }),
  );
  assert(a instanceof OpenRouterBillingError && b instanceof OpenRouterBillingError);
  assertEquals(
    [a.limitSource, a.limitUsd, a.spendUsd, a.resetsAt, a.scope],
    ["openrouter_in_flight_budget", 10, 9.5, "2026-10-13T00:00:00Z", "key"],
  );
  assertEquals(a.name, b.name);
  assertEquals([a.limitSource, a.limitUsd, a.spendUsd], [b.limitSource, b.limitUsd, b.spendUsd]);
  assertFalse("remedyHint" in a);
  assertFalse(JSON.stringify(Object.entries(a)).includes("contact support"));
});

Deno.test("Retry-After is parsed into retryAfterMs for 429 and for an in-flight-budget 402 only", () => {
  const rate = map(429, envelope({ message: "slow", code: 429 }), { "Retry-After": "7" });
  assert(rate instanceof RateLimitError);
  assertEquals((rate as RateLimitError & { retryAfterMs?: number }).retryAfterMs, 7000);

  const inFlight = map(
    402,
    envelope({ message: "limit", metadata: { limit_source: "openrouter_in_flight_budget" } }),
    { "Retry-After": "3" },
  );
  assert(inFlight instanceof OpenRouterBillingError);
  assertEquals(inFlight.retryAfterMs, 3000);

  const noWait = map(402, envelope({ message: "limit", metadata: { limit_source: "key_limit" } }), {
    "Retry-After": "3",
  });
  assert(noWait instanceof OpenRouterBillingError);
  assertEquals(noWait.retryAfterMs, undefined);

  const missing = map(429, envelope({ message: "slow", code: 429 }));
  assertEquals((missing as RateLimitError & { retryAfterMs?: number }).retryAfterMs, undefined);
});

Deno.test("Retry-After accepts an HTTP date and is capped", () => {
  const future = new Date(Date.now() + 60_000).toUTCString();
  const dated = map(429, envelope({ message: "slow" }), { "Retry-After": future }) as RateLimitError & {
    retryAfterMs?: number;
  };
  assert(dated.retryAfterMs !== undefined && dated.retryAfterMs > 0 && dated.retryAfterMs <= 60_000);

  const huge = map(429, envelope({ message: "slow" }), { "Retry-After": "99999999999" }) as RateLimitError & {
    retryAfterMs?: number;
  };
  assertEquals(huge.retryAfterMs, OPENROUTER_RETRY_AFTER_MAX_MS);

  const junk = map(429, envelope({ message: "slow" }), { "Retry-After": "soon" }) as RateLimitError & {
    retryAfterMs?: number;
  };
  assertEquals(junk.retryAfterMs, undefined);
});

Deno.test("a non-JSON or non-envelope error body falls back to the shared error", () => {
  for (
    const body of ["<html>502 Bad Gateway</html>", JSON.stringify({ foo: 1 }), JSON.stringify({ error: "plain" }), ""]
  ) {
    const fallback = new ConnectionError(PROVIDER_ID, "shared");
    assertStrictEquals(mapOpenRouterError(502, new Headers(), body, fallback), fallback);
  }
});

Deno.test("a 404 with failed_routing_step or routing_funnel is a routing refusal whatever its message says", () => {
  const ignored = map(
    404,
    envelope({
      message: "All providers have been ignored. To change your default ignored providers, visit: settings",
      code: 404,
      metadata: { failed_routing_step: "Filter by Ignored Providers", routing_funnel: [{ step: "Initial Endpoints" }] },
    }),
  );
  assert(ignored instanceof OpenRouterRoutingError);
  assertFalse(isRetryable(ignored));

  const allowed = map(
    404,
    envelope({
      message: "No allowed providers are available for the selected model.",
      metadata: { failed_routing_step: "Filter by Allowed Providers" },
    }),
  );
  assert(allowed instanceof OpenRouterRoutingError);

  const funnelOnly = map(404, envelope({ message: "some new wording", metadata: { routing_funnel: [] } }));
  assert(funnelOnly instanceof OpenRouterRoutingError);
});

Deno.test("a routing refusal names the failed routing step in the message", () => {
  const err = map(
    404,
    envelope({
      message: ROUTING_MESSAGE,
      metadata: { provider_name: "Alibaba", failed_routing_step: "Filter by Parameters" },
    }),
  );
  assertEquals(err.message, `HTTP 404 ${ROUTING_MESSAGE} (provider=Alibaba, routing_step=Filter by Parameters)`);
});

Deno.test("a plain 404 without routing evidence stays a shared model provider error", () => {
  const err = map(404, envelope({ message: "model not found", metadata: { provider_name: "Alibaba" } }));
  assertEquals(err.name, "ModelProviderError");
});
