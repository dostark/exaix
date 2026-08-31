// deno-lint-ignore-file no-explicit-any
/**
 * @module ModelAdapterTest
 * @path packages/ai/tests/providers/model_adapter_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies provider correctness for MockProvider and OllamaProvider.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { OllamaProvider } from "@exaix/ai-ollama";
import { MockProvider } from "../../src/providers.ts";
import type { IModelProvider } from "../../src/types.ts";
import { ConnectionError, ModelProviderError, TimeoutError } from "../../src/providers/common.ts";
import type { JSONObject } from "@exaix/core";

// Test 1: MockProvider returns configured response

Deno.test("MockProvider returns configured response", async () => {
  const expectedResponse = "This is a test response from the mock provider";
  const provider = new MockProvider(expectedResponse);

  const result = await provider.generate("Any prompt here");

  assertEquals(result.content, expectedResponse);
});

Deno.test("MockProvider has correct id", () => {
  const provider = new MockProvider("test", "custom-mock-id");

  assertEquals(provider.id, "custom-mock-id");
});

Deno.test("MockProvider uses default id when not specified", () => {
  const provider = new MockProvider("test");

  assertEquals(provider.id, "mock-provider");
});

Deno.test("MockProvider ignores prompt content", async () => {
  const expectedResponse = "Same response every time";
  const provider = new MockProvider(expectedResponse);

  const result1 = await provider.generate("First prompt");
  const result2 = await provider.generate("Different prompt");

  assertEquals(result1.content, expectedResponse);
  assertEquals(result2.content, expectedResponse);
});

// Test 2: OllamaProvider sends correct JSON payload

Deno.test("OllamaProvider sends correct JSON payload to /api/generate", async () => {
  let capturedRequest: Request | undefined;
  let capturedBody: any = null;

  // Mock fetch to capture the request
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedRequest = new Request(input, init);
    capturedBody = JSON.parse(init?.body as string);

    // Return a valid Ollama response
    return Promise.resolve(
      new Response(
        JSON.stringify({
          response: "Test response from Ollama",
          done: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as () => Promise<Response>;

  try {
    const provider = new OllamaProvider({ model: "llama3.2" });
    const result = await provider.generate("Test prompt", {
      temperature: 0.7,
      max_tokens: 100,
    });

    // Verify fetch was called with correct URL
    assertExists(capturedRequest);
    assertEquals(capturedRequest!.url, "http://localhost:11434/api/generate");
    assertEquals(capturedRequest!.method, "POST");

    // Verify request body structure
    assertExists(capturedBody);

    const body = capturedBody as JSONObject;
    assertEquals(body.model, "llama3.2");
    assertEquals(body.prompt, "Test prompt");
    assertEquals(body.stream, false);

    // Verify options are passed correctly
    const options = body.options as JSONObject;
    assertEquals(options.temperature, 0.7);
    assertEquals(options.num_predict, 100);

    // Verify response is parsed correctly
    assertEquals(result.content, "Test response from Ollama");
  } finally {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider uses default baseUrl and model", async () => {
  let capturedUrl = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    capturedUrl = input.toString();
    return Promise.resolve(new Response(JSON.stringify({ response: "test" }), { status: 200 }));
  }) as () => Promise<Response>;

  try {
    const provider = new OllamaProvider();
    await provider.generate("test");

    assertEquals(capturedUrl, "http://localhost:11434/api/generate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider accepts custom baseUrl", async () => {
  let capturedUrl = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    capturedUrl = input.toString();
    return Promise.resolve(new Response(JSON.stringify({ response: "test" }), { status: 200 }));
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider({ baseUrl: "http://custom-host:8080" });
    await provider.generate("test");

    assertEquals(capturedUrl, "http://custom-host:8080/api/generate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Test 3: Provider handles connection errors gracefully

Deno.test("OllamaProvider throws ConnectionError on network failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new TypeError("fetch failed");
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider();

    await assertRejects(
      async () => await provider.generate("test"),
      ConnectionError,
      "Failed to connect to Ollama",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider throws ConnectionError on HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.resolve(new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" }));
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider();

    await assertRejects(
      async () => await provider.generate("test"),
      ConnectionError,
      "HTTP 503",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider throws TimeoutError on timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    // Simulate a slow response that will be aborted
    return new Promise((_, reject) => {
      const checkAbort = () => {
        if (init?.signal?.aborted) {
          reject(new DOMException("The operation was aborted", "AbortError"));
        } else {
          setTimeout(checkAbort, 10);
        }
      };
      checkAbort();
    });
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider({ timeoutMs: 100 });

    await assertRejects(
      async () => await provider.generate("test"),
      TimeoutError,
      "timed out after 100ms",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("ConnectionError includes provider name", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new TypeError("fetch failed");
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider({ id: "test-ollama-provider" });

    try {
      await provider.generate("test");
      throw new Error("Should have thrown ConnectionError");
    } catch (error) {
      assertExists(error);
      assertEquals((error as ConnectionError).name, "ConnectionError");
      assertEquals((error as ConnectionError).provider, "test-ollama-provider");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider throws ModelProviderError on invalid JSON response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.resolve(new Response("Invalid JSON", { status: 200 }));
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider();

    await assertRejects(
      async () => await provider.generate("test"),
      ModelProviderError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider throws ModelProviderError when response field is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.resolve(new Response(JSON.stringify({ done: true }), { status: 200 }));
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider();

    await assertRejects(
      async () => await provider.generate("test"),
      ModelProviderError,
      "missing 'response' field",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Additional Edge Case Tests

Deno.test("MockProvider handles empty prompt", async () => {
  const provider = new MockProvider("response");
  const result = await provider.generate("");

  assertEquals(result.content, "response");
});

Deno.test("OllamaProvider handles empty prompt", async () => {
  let capturedBody: any = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return Promise.resolve(new Response(JSON.stringify({ response: "ok" }), { status: 200 }));
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider();
    await provider.generate("");

    const body = capturedBody as JSONObject;
    assertEquals(body.prompt, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OllamaProvider handles very long prompts", async () => {
  const longPrompt = "a".repeat(100000); // 100k characters
  let capturedBody: any = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return Promise.resolve(new Response(JSON.stringify({ response: "ok" }), { status: 200 }));
  }) as typeof globalThis.fetch;

  try {
    const provider = new OllamaProvider();
    await provider.generate(longPrompt);

    const body = capturedBody as { prompt: string };
    assertEquals(body.prompt, longPrompt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("IModelProvider interface is correctly implemented by all providers", () => {
  const providers: IModelProvider[] = [
    new MockProvider("test"),
    new OllamaProvider(),
  ];

  for (const provider of providers) {
    assertExists(provider.id);
    assertExists(provider.generate);
    assertEquals(typeof provider.id, "string");
    assertEquals(typeof provider.generate, "function");
  }
});

Deno.test("Provider IDs are unique per instance", () => {
  const mock1 = new MockProvider("test", "id1");
  const mock2 = new MockProvider("test", "id2");
  const ollama1 = new OllamaProvider({ model: "llama3.2" });
  const ollama2 = new OllamaProvider({ model: "mistral" });

  assertEquals(mock1.id, "id1");
  assertEquals(mock2.id, "id2");
  assertStringIncludes(ollama1.id, "llama3.2");
  assertStringIncludes(ollama2.id, "mistral");
});
