/**
 * @module ProviderErrorClassificationTest
 * @path packages/ai/tests/provider_error_classification_test.ts
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai/src/providers/common.ts]
 * @architectural-layer AI
 * @description Verifies Exaix classifies every error shape the Anthropic Messages API
 * documents (docs.anthropic.com/en/api/errors): the machine-readable error.type must be
 * surfaced in the thrown message, classification must be driven by the error type (with
 * HTTP status as fallback), and retryability must match the error's documented semantics —
 * transient (rate_limit_error, overloaded_error, api_error) retries; caller mistakes
 * (invalid_request_error, not_found_error, request_too_large) and credential problems
 * (authentication_error, permission_error) do not.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { BillingError } from "@exaix/ai/providers";
import { handleProviderResponse, type ProviderErrorMapper as ErrorMapper } from "../src/provider_common_utils.ts";
import {
  AuthenticationError,
  ConnectionError,
  isRetryable,
  ModelProviderError,
  RateLimitError,
} from "../src/providers/common.ts";

const PROVIDER_ID = "anthropic-test";

const BILLING_SENTINEL = "remote-billing-detail";
Deno.test("a 402 body maps to BillingError for Anthropic, Google, OpenAI, OpenRouter, openai-chat and DeepSeek", async () => {
  for (const provider of ["anthropic", "google", "openai", "openrouter", "openai-chat", "deepseek"]) {
    const error = await assertRejects(
      () => handleProviderResponse(anthropicErrorResponse(402, "api_error", BILLING_SENTINEL), provider),
      BillingError,
    );
    assertEquals(error.provider, provider);
    assertEquals(isRetryable(error), false);
  }
});

Deno.test("the compatible branch message stays HTTP 402 for typed, plain and malformed remote bodies", async () => {
  for (
    const body of [
      JSON.stringify({ error: { type: "api_error", message: BILLING_SENTINEL } }),
      BILLING_SENTINEL,
      "{",
    ]
  ) {
    const error = await assertRejects(
      () =>
        handleProviderResponse(new Response(body, { status: 402 }), "openai-chat", undefined, undefined, {
          exposeRemoteErrorText: false,
        }),
      BillingError,
    );
    assertEquals(error.message, "HTTP 402");
    assertEquals(isRetryable(error), false);
  }
});

function anthropicErrorResponse(status: number, errorType: string, message: string): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type: errorType, message } }),
    { status },
  );
}

async function classify(status: number, errorType: string, message: string): Promise<Error> {
  try {
    await handleProviderResponse(anthropicErrorResponse(status, errorType, message), PROVIDER_ID);
  } catch (error) {
    return error as Error;
  }
  throw new Error("handleProviderResponse did not throw for an error response");
}

type ProviderErrorClass =
  | typeof ModelProviderError
  | typeof AuthenticationError
  | typeof RateLimitError
  | typeof ConnectionError;

interface IErrorClassificationCase {
  status: number;
  type: string;
  expectClass: ProviderErrorClass;
  expectRetryable: boolean;
}

Deno.test("[anthropic-errors] every documented error type maps to the right class and retryability", async () => {
  const cases: IErrorClassificationCase[] = [
    { status: 400, type: "invalid_request_error", expectClass: ModelProviderError, expectRetryable: false },
    { status: 401, type: "authentication_error", expectClass: AuthenticationError, expectRetryable: false },
    { status: 403, type: "permission_error", expectClass: AuthenticationError, expectRetryable: false },
    { status: 404, type: "not_found_error", expectClass: ModelProviderError, expectRetryable: false },
    { status: 413, type: "request_too_large", expectClass: ModelProviderError, expectRetryable: false },
    { status: 429, type: "rate_limit_error", expectClass: RateLimitError, expectRetryable: true },
    { status: 500, type: "api_error", expectClass: ConnectionError, expectRetryable: true },
    { status: 529, type: "overloaded_error", expectClass: ConnectionError, expectRetryable: true },
  ];

  for (const c of cases) {
    const err = await classify(c.status, c.type, `${c.type} occurred`);
    assert(
      err instanceof c.expectClass,
      `${c.type} (HTTP ${c.status}) should throw ${c.expectClass.name}, got ${err.name}`,
    );
    assertEquals(
      isRetryable(err),
      c.expectRetryable,
      `${c.type} retryability should be ${c.expectRetryable}`,
    );
  }
});

Deno.test("[anthropic-errors] the machine-readable error type is surfaced in the message", async () => {
  const err = await classify(400, "invalid_request_error", "`temperature` is deprecated for this model.");
  assert(
    err.message.includes("invalid_request_error"),
    `message should carry the API's error type for diagnosis, got: "${err.message}"`,
  );
  assert(err.message.includes("`temperature` is deprecated for this model."));
});

Deno.test("[anthropic-errors] error type wins over an unexpected HTTP status", async () => {
  // If Anthropic ever returns a documented transient type under a surprising status,
  // classification must follow the type, not the status — otherwise a retryable
  // overloaded_error under e.g. 400 would be treated as a permanent caller mistake.
  const overloaded = await classify(400, "overloaded_error", "Overloaded");
  assert(
    overloaded instanceof ConnectionError,
    `overloaded_error should classify as ConnectionError regardless of status, got ${overloaded.name}`,
  );

  const rateLimited = await classify(400, "rate_limit_error", "Too many requests");
  assert(
    rateLimited instanceof RateLimitError,
    `rate_limit_error should classify as RateLimitError regardless of status, got ${rateLimited.name}`,
  );
});

Deno.test("[anthropic-errors] a body without a typed error still classifies by HTTP status", async () => {
  const plain = new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
  await assertRejects(
    () => handleProviderResponse(plain, PROVIDER_ID),
    ConnectionError,
  );
});

const MAPPER_PROVIDER_ID = "mapper-test";

function plainErrorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: `status ${status} detail` } }), {
    status,
    headers: { "Retry-After": "9" },
  });
}

async function thrownBy(response: Response, errorMapper?: ErrorMapper): Promise<Error> {
  try {
    await handleProviderResponse(response, MAPPER_PROVIDER_ID, undefined, undefined, { errorMapper });
  } catch (error) {
    return error as Error;
  }
  throw new Error("handleProviderResponse did not throw for an error response");
}

Deno.test("[regression] without errorMapper, 401, 404, 429, 500 and 503 throw the same class and message as before", async () => {
  const expected: Array<[number, string, string]> = [
    [401, "AuthenticationError", "HTTP 401 status 401 detail"],
    [404, "ModelProviderError", "HTTP 404 status 404 detail"],
    [429, "RateLimitError", "HTTP 429 status 429 detail"],
    [500, "ConnectionError", `Connection failed for provider '${MAPPER_PROVIDER_ID}': HTTP 500 status 500 detail`],
    [503, "ConnectionError", `Connection failed for provider '${MAPPER_PROVIDER_ID}': HTTP 503 status 503 detail`],
  ];
  for (const [status, name, message] of expected) {
    const err = await thrownBy(plainErrorResponse(status));
    assertEquals([err.name, err.message], [name, message], `status ${status}`);
  }
});

Deno.test("errorMapper receives the status, headers, body text and the shared fallback, and its return value is thrown", async () => {
  const seen: Array<{ status: number; retryAfter: string | null; body: string; fallbackName: string }> = [];
  const custom = new ModelProviderError("mapped", MAPPER_PROVIDER_ID);
  const err = await thrownBy(plainErrorResponse(429), (status, headers, bodyText, fallback) => {
    seen.push({ status, retryAfter: headers.get("Retry-After"), body: bodyText, fallbackName: fallback.name });
    return custom;
  });
  assertEquals(err, custom);
  assertEquals(seen, [{
    status: 429,
    retryAfter: "9",
    body: JSON.stringify({ error: { message: "status 429 detail" } }),
    fallbackName: "RateLimitError",
  }]);
});

Deno.test("errorMapper is not called for a 2xx response", async () => {
  let calls = 0;
  const data = await handleProviderResponse<{ ok: boolean }>(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
    MAPPER_PROVIDER_ID,
    undefined,
    undefined,
    {
      errorMapper: (_status, _headers, _bodyText, fallback) => {
        calls++;
        return fallback;
      },
    },
  );
  assertEquals(data, { ok: true });
  assertEquals(calls, 0);
});
