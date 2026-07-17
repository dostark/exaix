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
import { handleProviderResponse } from "../src/provider_common_utils.ts";
import {
  AuthenticationError,
  ConnectionError,
  isRetryable,
  ModelProviderError,
  RateLimitError,
} from "../src/providers/common.ts";

const PROVIDER_ID = "anthropic-test";

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
