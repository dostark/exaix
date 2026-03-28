/**
 * @module FreeProvidersTest
 * @path tests/ai/free_providers_test.ts
 * @description Verifies the integration with free or local LLM providers, ensuring
 * correct model mapping and payload formatting for budget-conscious execution.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { ModelFactory } from "../../src/ai/providers.ts";
import { OpenAIProvider } from "../../src/ai/providers/openai_provider.ts";
import { getTestModel, getTestModelDisplay } from "./helpers/test_model.ts";
import { isCi } from "../helpers/env.ts";

import type { JSONObject } from "../../src/shared/types/json.ts";

function isCiGuardActive(): boolean {
  // In CI, the code intentionally prevents accidental paid calls unless
  // explicitly opted-in.
  return isCi() && Deno.env.get("EXA_TEST_ENABLE_PAID_LLM") !== "1";
}

Deno.test("ModelFactory creates OpenAIProvider for default test model", async () => {
  const model = getTestModel();
  const provider = await ModelFactory.create(model, { apiKey: "test-key", baseUrl: "https://api.test" });

  assertExists(provider);

  if (isCiGuardActive()) {
    // In CI without opt-in, ModelFactory returns a mock provider.
    assertStringIncludes(provider.id, "mock-provider");
    return;
  }

  // The provider should be an OpenAIProvider with model reflected in id
  assertStringIncludes(provider.id, `openai-${model}`);
  assertExists(provider.generate);
});

Deno.test("OpenAIProvider sends correct payload and returns content for default test model", async () => {
  const model = getTestModel();
  const modelDisplay = getTestModelDisplay();

  // Capture request
  let capturedUrl = "";
  let capturedBody: unknown = null;

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

    assertEquals(res, `Hello from ${modelDisplay}`);
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

Deno.test("ModelFactory creates provider for 'gpt-5-mini' and 'gpt-4o' types", async () => {
  const p1 = await ModelFactory.create("gpt-5-mini", { apiKey: "k" });
  const p2 = await ModelFactory.create("gpt-4o", { apiKey: "k" });

  if (isCiGuardActive()) {
    assertStringIncludes(p1.id, "mock-provider");
    assertStringIncludes(p2.id, "mock-provider");
    return;
  }

  assertStringIncludes(p1.id, "openai-gpt-5-mini");
  assertStringIncludes(p2.id, "openai-gpt-4o");
});
