/**
 * @module OpenAIShimRetryTest
 * @path tests/ai/openai_shim_retry_test.ts
 * @description Verifies the retry logic for OpenAI-compatible LLM endpoints,
 * ensuring robust recovery from transient 429 (Rate Limit) errors.
 */

import { assertEquals, assertExists } from "@std/assert";
import { ModelFactory } from "../../src/ai/providers.ts";
import { getTestModel } from "./helpers/test_model.ts";
import { isCi } from "../helpers/env.ts";
import { DEFAULT_OPENAI_BASE_URL } from "../../src/shared/constants.ts";

function isCiGuardActive(): boolean {
  return isCi() && Deno.env.get("EXA_TEST_ENABLE_PAID_LLM") !== "1";
}

Deno.test("OpenAIShim retries on 429 and returns content", async () => {
  // Arrange: Use ModelFactory to create the shim instance
  const model = getTestModel();
  const provider = await ModelFactory.create(model, { apiKey: "test-key", baseUrl: "https://api.test" });

  if (isCiGuardActive()) {
    // In CI without opt-in, ModelFactory intentionally returns a mock provider.
    const res = await provider.generate("Hello");
    const ok = res === "CI-protectedmock" || res === "CI-protected mock";
    assertEquals(ok, true);
    return;
  }

  let calls = 0;
  const originalFetch = globalThis.fetch;

  // First call returns 429, second returns a valid body
  globalThis.fetch = () => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(new Response("", { status: 429, statusText: "Too Many Requests" }));
    }

    const body = JSON.stringify({ choices: [{ message: { content: "ok-response" } }] });
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  };

  try {
    const res = await provider.generate("Hello");
    assertEquals(res, "ok-response");
    assertEquals(calls, 2);
  } finally {
    // Restore global fetch
    globalThis.fetch = originalFetch;
  }
});

// --------------------------------------------------------------------------
// Manual sanity test: check actual provider availability (opt-in)
// This test is ignored unless EXA_TEST_ENABLE_PAID_LLM=1 and EXA_TEST_OPENAI_API_KEY is set.
// --------------------------------------------------------------------------
const _enabled = Deno.env.get("EXA_TEST_ENABLE_PAID_LLM");
Deno.test({ name: "OpenAIShim: sanity check against real LLM (manual)", ignore: _enabled !== "1" }, async () => {
  const apiKey = Deno.env.get("EXA_TEST_OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("Skipping manual LLM availability test: EXA_TEST_OPENAI_API_KEY not set");
    return;
  }

  const model = getTestModel();
  const provider = await ModelFactory.create(model, { apiKey, baseUrl: DEFAULT_OPENAI_BASE_URL });

  try {
    const res = await provider.generate("Sanity check: are you available? Reply with 'ok'.");
    assertExists(res, "Provider should return a non-empty response");
    console.log("LLM sanity check succeeded: response length=" + (res as string).length);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Treat rate limiting, auth, or missing-model errors as informational skips for manual runs
    if (msg.includes("429")) {
      console.warn("LLM sanity check: skipped due to rate limit (429)");
      return;
    }

    if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
      console.warn("LLM sanity check: skipped due to unauthorized (401). Check EXA_TEST_OPENAI_API_KEY.");
      return;
    }

    if (msg.includes("404") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("model")) {
      console.warn("LLM sanity check: skipped due to model not found (404). Check EXA_TEST_LLM_MODEL and API access.");
      return;
    }

    // Skip on quota errors (insufficient_quota / exceeded your current quota)
    if (msg.toLowerCase().includes("insufficient_quota") || msg.toLowerCase().includes("exceeded your current quota")) {
      console.warn(
        "LLM sanity check: skipped due to insufficient quota. Check billing and usage on your OpenAI account.",
      );
      return;
    }

    // Rethrow any other unexpected errors so they are visible
    throw e;
  }
});
