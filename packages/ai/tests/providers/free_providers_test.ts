// deno-lint-ignore-file no-explicit-any
/**
 * @module FreeProvidersTest
 * @path packages/ai/tests/providers/free_providers_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies the integration with free or local LLM providers, ensuring
 * correct model mapping and payload formatting for budget-conscious execution.
 */

import { assertEquals, assertExists } from "@std/assert";
import { OpenAIProvider } from "@exaix/ai-openai";
import { getTestModel, getTestModelDisplay } from "../helpers/test_model.ts";

import type { JSONObject } from "@exaix/core";

Deno.test("OpenAIProvider sends correct payload and returns content for default test model", async () => {
  const model = getTestModel();
  const modelDisplay = getTestModelDisplay();

  // Capture request
  let capturedUrl = "";
  let capturedBody: any = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = input.toString();
    capturedBody = init?.body ? JSON.parse(init.body as string) : null;

    const body = JSON.stringify({
      choices: [{ message: { content: `Hello from ${modelDisplay}` } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });

    return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as () => Promise<Response>;

  try {
    const provider = new OpenAIProvider({ apiKey: "test-key", model, baseUrl: "https://api.test" });
    const res = await provider.generate("Test prompt", { temperature: 0.1, max_tokens: 50 });

    assertEquals(res.content, `Hello from ${modelDisplay}`);
    // OpenAIProvider uses the provided baseUrl verbatim (caller may provide full endpoint)
    assertEquals(capturedUrl, "https://api.test");

    assertExists(capturedBody);
    const bodyObj = capturedBody as JSONObject;
    assertEquals(bodyObj.model, model);
    assertExists(bodyObj.messages);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
