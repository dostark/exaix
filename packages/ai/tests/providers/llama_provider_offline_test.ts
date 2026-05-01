// deno-lint-ignore-file no-explicit-any
/**
 * @module LlamaProviderOfflineTest
 * @path tests/ai/llama_provider_offline_test.ts
 * @description Verifies the offline parsing capabilities of the Llama provider,
 * ensuring robust extraction of structured JSON from LLM markdown responses.
 */

import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
  TEST_LLAMAPROVIDER_JSON_BODY,
  TEST_LLAMAPROVIDER_MODEL_CODELLAMA,
  TEST_LLAMAPROVIDER_MODEL_LLAMA,
  TEST_LLAMAPROVIDER_PROMPT,
  TEST_OLLAMA_ENDPOINT,
  TEST_PROVIDER_TIMEOUT_MS_SHORT,
  TEST_RETRY_BACKOFF_BASE_MS_ZERO,
  TEST_RETRY_MAX_ATTEMPTS_SINGLE,
} from "@exaix/testing";
import { LlamaProvider } from "../../src/providers/llama_provider.ts";

function jsonResponse(body: any, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

Deno.test("LlamaProvider: constructor rejects unsupported model", () => {
  assertThrows(
    () => new LlamaProvider({ model: "invalid-model" }),
    Error,
    "Unsupported model",
  );
});

Deno.test("LlamaProvider: returns JSON extracted from markdown code block", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((_input: any, _init?: any) =>
      Promise.resolve(
        jsonResponse({
          response: `Here you go:\n\n\`\`\`json\n${TEST_LLAMAPROVIDER_JSON_BODY}\n\`\`\`\n`,
        }),
      )) as typeof globalThis.fetch;

    const provider = new LlamaProvider({
      model: TEST_LLAMAPROVIDER_MODEL_CODELLAMA,
      endpoint: TEST_OLLAMA_ENDPOINT,
      maxAttempts: TEST_RETRY_MAX_ATTEMPTS_SINGLE,
      backoffBaseMs: TEST_RETRY_BACKOFF_BASE_MS_ZERO,
      timeoutMs: TEST_PROVIDER_TIMEOUT_MS_SHORT,
    });

    const out = await provider.generate(TEST_LLAMAPROVIDER_PROMPT);
    assertEquals(out.content, TEST_LLAMAPROVIDER_JSON_BODY);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("LlamaProvider: extracts JSON object from surrounding text", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((_input: any, _init?: any) =>
      Promise.resolve(
        jsonResponse({
          response: `prefix ${TEST_LLAMAPROVIDER_JSON_BODY} suffix`,
        }),
      )) as typeof globalThis.fetch;

    const provider = new LlamaProvider({
      model: TEST_LLAMAPROVIDER_MODEL_LLAMA,
      endpoint: TEST_OLLAMA_ENDPOINT,
      maxAttempts: TEST_RETRY_MAX_ATTEMPTS_SINGLE,
      backoffBaseMs: TEST_RETRY_BACKOFF_BASE_MS_ZERO,
      timeoutMs: TEST_PROVIDER_TIMEOUT_MS_SHORT,
    });

    const out = await provider.generate(TEST_LLAMAPROVIDER_PROMPT);
    assertEquals(out.content, TEST_LLAMAPROVIDER_JSON_BODY);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("LlamaProvider: returns raw response when JSON parsing fails", async () => {
  const originalFetch = globalThis.fetch;
  const raw = "not a json";

  try {
    globalThis.fetch = ((_input: any, _init?: any) =>
      Promise.resolve(jsonResponse({ response: raw }))) as typeof globalThis.fetch;

    const provider = new LlamaProvider({
      model: TEST_LLAMAPROVIDER_MODEL_LLAMA,
      endpoint: TEST_OLLAMA_ENDPOINT,
      maxAttempts: TEST_RETRY_MAX_ATTEMPTS_SINGLE,
      backoffBaseMs: TEST_RETRY_BACKOFF_BASE_MS_ZERO,
      timeoutMs: TEST_PROVIDER_TIMEOUT_MS_SHORT,
    });

    const out = await provider.generate(TEST_LLAMAPROVIDER_PROMPT);
    assertEquals(out.content, raw);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("LlamaProvider: throws on invalid Ollama response shape", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = ((_input: any, _init?: any) =>
      Promise.resolve(
        jsonResponse({ somethingElse: "no response field" }),
      )) as typeof globalThis.fetch;

    const provider = new LlamaProvider({
      model: TEST_LLAMAPROVIDER_MODEL_LLAMA,
      endpoint: TEST_OLLAMA_ENDPOINT,
      maxAttempts: TEST_RETRY_MAX_ATTEMPTS_SINGLE,
      backoffBaseMs: TEST_RETRY_BACKOFF_BASE_MS_ZERO,
      timeoutMs: TEST_PROVIDER_TIMEOUT_MS_SHORT,
    });

    await assertRejects(
      () => provider.generate(TEST_LLAMAPROVIDER_PROMPT),
      Error,
      "Invalid Ollama response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("LlamaProvider: surfaces HTTP errors from provider_common_utils", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = ((_input: any, _init?: any) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "boom" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof globalThis.fetch;

    const provider = new LlamaProvider({
      model: TEST_LLAMAPROVIDER_MODEL_LLAMA,
      endpoint: TEST_OLLAMA_ENDPOINT,
      maxAttempts: TEST_RETRY_MAX_ATTEMPTS_SINGLE,
      backoffBaseMs: TEST_RETRY_BACKOFF_BASE_MS_ZERO,
      timeoutMs: TEST_PROVIDER_TIMEOUT_MS_SHORT,
    });

    try {
      await provider.generate(TEST_LLAMAPROVIDER_PROMPT);
      throw new Error("Expected generate() to throw");
    } catch (err) {
      assertStringIncludes(String(err), "HTTP 500");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
