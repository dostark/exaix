/**
 * @module AnthropicParamRejectionRetryTest
 * @path packages/ai-anthropic/tests/anthropic_param_rejection_retry_test.ts
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts]
 * @architectural-layer AI
 * @description Regression test for parameter-rejection self-healing. Claude 5 family
 * models reject the `temperature` parameter with HTTP 400 ("`temperature` is deprecated
 * for this model.") — observed live when ReActLoopStrategy's execution call
 * (which always passes temperature) hit claude-sonnet-5 and failed instantly, killing
 * the swe_tasks execution phase. The provider must strip the named parameter and retry
 * once instead of failing the whole execution over a tuning knob.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { AnthropicProvider } from "../mod.ts";
import type { JSONValue } from "@exaix/core";

const TEMPERATURE_REJECTION_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." },
});

const SUCCESS_BODY = JSON.stringify({
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

Deno.test("AnthropicProvider strips a 400-rejected parameter and retries once", async () => {
  const requestBodies: Array<Record<string, JSONValue>> = [];
  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: URL | RequestInfo, init?: RequestInit) => {
      requestBodies.push(JSON.parse(init?.body as string));
      const isFirstCall = requestBodies.length === 1;
      return Promise.resolve(
        isFirstCall
          ? new Response(TEMPERATURE_REJECTION_BODY, { status: 400 })
          : new Response(SUCCESS_BODY, { status: 200 }),
      );
    },
  );

  try {
    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-sonnet-5" });
    const result = await provider.generate("hello", { temperature: 0.2 });

    assertEquals(result.content, "ok");
    assertEquals(requestBodies.length, 2, "exactly one retry after the parameter rejection");
    assertExists(requestBodies[0].temperature, "first attempt carries the caller's temperature");
    assertEquals(requestBodies[1].temperature, undefined, "retry must omit the rejected parameter");
    assertEquals(requestBodies[1].model, requestBodies[0].model, "retry only strips the rejected parameter");
  } finally {
    fetchStub.restore();
  }
});

Deno.test("AnthropicProvider does not retry a 400 that names no sent parameter", async () => {
  let callCount = 0;
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => {
      callCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ type: "error", error: { message: "max_tokens: must be positive" } }),
          { status: 400 },
        ),
      );
    },
  );

  try {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-5",
      maxRetries: 1,
    });
    await assertRejects(() => provider.generate("hello", { temperature: 0.2 }));
    assertEquals(callCount, 1, "a non-parameter-rejection 400 must not trigger the strip-retry");
  } finally {
    fetchStub.restore();
  }
});
