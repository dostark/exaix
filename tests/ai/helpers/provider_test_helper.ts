/**
 * @module AIProviderTestHelper
 * @path tests/ai/helpers/provider_test_helper.ts
 * @description Provides a reusable test harness for AI providers, verifying standard
 * request/response patterns and error handling across varied LLM backends.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { Spy, spy, Stub, stub } from "https://deno.land/std@0.203.0/testing/mock.ts"; // No change
import { ModelProviderError } from "../../../src/ai/providers/common.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import type { JSONObject } from "../../../src/shared/types/json.ts";

/** Configuration for provider-specific response formats */
export interface IProviderResponseConfig {
  /** How to wrap the response text in the provider's response format */
  wrapResponse: (text: string) => unknown;
  /** How to create usage metadata in the provider's format */
  createUsage: (promptTokens: number, completionTokens: number) => unknown;
  /** Combine response and usage into full response object */
  createFullResponse: (text: string, promptTokens: number, completionTokens: number) => unknown;
}

/** Configuration for a complete provider test suite */
export interface ProviderTestSuiteConfig<T> {
  /** Provider name for test descriptions */
  name: string;
  /** Factory to create provider instance */
  createProvider: (options?: JSONObject, logger?: EventLogger) => T;
  /** Provider's expected default ID */
  defaultId: string;
  /** Response format configuration */
  responseConfig: IProviderResponseConfig;
  /** Expected header key for API key (e.g., "Authorization" or "x-api-key") */
  apiKeyHeader: string;
  /** Expected header value format (e.g., "Bearer test-key" or "test-key") */
  apiKeyValue: string;
  /** Additional headers to verify (optional) */
  additionalHeaders?: Record<string, string>;
  /** How the provider maps stop sequences in request body */
  stopSequenceKey?: string;
}

// OpenAI response format
export const openaiResponseConfig: IProviderResponseConfig = {
  wrapResponse: (text: string) => ({ choices: [{ message: { content: text } }] }),
  createUsage: (prompt: number, completion: number) => ({
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  }),
  createFullResponse: (text: string, prompt: number, completion: number) => ({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  }),
};

// Anthropic response format
export const anthropicResponseConfig: IProviderResponseConfig = {
  wrapResponse: (text: string) => ({ content: [{ text }] }),
  createUsage: (prompt: number, completion: number) => ({
    usage: { input_tokens: prompt, output_tokens: completion, total_tokens: prompt + completion },
  }),
  createFullResponse: (text: string, prompt: number, completion: number) => ({
    content: [{ text }],
    usage: { input_tokens: prompt, output_tokens: completion, total_tokens: prompt + completion },
  }),
};

// Google response format
export const googleResponseConfig: IProviderResponseConfig = {
  wrapResponse: (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  createUsage: (prompt: number, completion: number) => ({
    usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: completion, totalTokens: prompt + completion },
  }),
  createFullResponse: (text: string, prompt: number, completion: number) => ({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: completion, totalTokens: prompt + completion },
  }),
};

/**
 * Creates a fetch stub that returns a successful response.
 */
export function stubFetchSuccess(responseBody: unknown): Stub {
  return stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 })),
  );
}

/**
 * Creates a fetch stub that returns an error response.
 */
export function stubFetchError(errorMessage: string, status: number): Stub {
  return stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response(JSON.stringify({ error: { message: errorMessage } }), { status })),
  );
}

/**
 * Creates a fetch spy for inspecting request details.
 */
export function spyFetch(responseBody: unknown): { spy: Spy; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const fetchSpy = spy(() => Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 })));

  globalThis.fetch = fetchSpy;

  return {
    spy: fetchSpy,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/**
 * Test initialization with default and custom IDs.
 */
export function testProviderInitialization<T extends { id: string }>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
  defaultId: string,
): void {
  Deno.test(`${name} - initialization`, () => {
    const logger = new EventLogger({ prefix: "[Test]" });
    const provider = createProvider({ apiKey: "test-key" }, logger);
    assertEquals(provider.id, defaultId);

    const customProvider = createProvider({
      apiKey: "test-key",
      model: "custom-model",
      id: "custom-id",
    }, logger);
    assertEquals(customProvider.id, "custom-id");
  });
}

/**
 * Test successful text generation.
 */
export function testProviderGenerateSuccess<T extends { generate: (prompt: string) => Promise<string> }>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
  responseConfig: IProviderResponseConfig,
  expectedText: string,
): void {
  Deno.test(`${name} - generate success`, async () => {
    const provider = createProvider({ apiKey: "test-key" });
    const mockResponse = responseConfig.createFullResponse(expectedText, 10, 20);

    const fetchStub = stubFetchSuccess(mockResponse);

    try {
      const result = await provider.generate("Hi");
      assertEquals(result, expectedText);
    } finally {
      fetchStub.restore();
    }
  });
}

/**
 * Test API key header is sent correctly.
 */
export function testProviderHeaders<T extends { generate: (prompt: string) => Promise<string> }>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
  responseConfig: IProviderResponseConfig,
  apiKeyHeader: string,
  apiKeyValue: string,
  additionalHeaders?: Record<string, string>,
): void {
  Deno.test(`${name} - generate headers`, async () => {
    const provider = createProvider({ apiKey: "test-key" });
    const { spy: fetchSpy, restore } = spyFetch(responseConfig.wrapResponse("ok"));

    try {
      await provider.generate("Hi");
      const call = fetchSpy.calls[0];
      const headers = call.args[1]?.headers as Record<string, string>;
      assertEquals(headers[apiKeyHeader], apiKeyValue);

      if (additionalHeaders) {
        for (const [key, value] of Object.entries(additionalHeaders)) {
          assertEquals(headers[key], value);
        }
      }
    } finally {
      restore();
    }
  });
}

/**
 * Test error handling for API errors.
 */
export function testProviderErrorHandling<T extends { generate: (prompt: string) => Promise<string> }>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
): void {
  Deno.test(`${name} - generate error handling`, async () => {
    const provider = createProvider({ apiKey: "test-key" });

    const fetchStub = stubFetchError("Invalid key", 401);

    try {
      await assertRejects(
        () => provider.generate("Hi"),
        ModelProviderError,
        "Invalid key",
      );
    } finally {
      fetchStub.restore();
    }
  });
}

/**
 * Test options mapping (temperature, max_tokens, etc.).
 */

export function testProviderOptionsMapping<
  T extends { generate: (prompt: string, options?: JSONObject) => Promise<string> },
>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
  responseConfig: IProviderResponseConfig,
  stopSequenceKey: string = "stop",
): void {
  Deno.test(`${name} - options mapping`, async () => {
    const provider = createProvider({ apiKey: "test-key" });
    const { spy: fetchSpy, restore } = spyFetch(responseConfig.wrapResponse("ok"));

    try {
      await provider.generate("Hi", {
        temperature: 0.5,
        max_tokens: 100,
        top_p: 0.9,
        stop: ["STOP"],
      });

      const call = fetchSpy.calls[0];
      const body = JSON.parse(call.args[1]?.body as string);

      // Handle different provider body structures
      const temp = body.temperature ?? body.generationConfig?.temperature;
      const maxTokens = body.max_tokens ?? body.generationConfig?.maxOutputTokens;
      const topP = body.top_p ?? body.generationConfig?.topP;
      const stopSeqs = body[stopSequenceKey] ?? body.generationConfig?.stopSequences;

      assertEquals(temp, 0.5);
      assertEquals(maxTokens, 100);
      assertEquals(topP, 0.9);
      assertEquals(stopSeqs, ["STOP"]);
    } finally {
      restore();
    }
  });
}

/**
 * Test token usage reporting via EventLogger.
 */
export function testProviderTokenUsage<T extends { generate: (prompt: string) => Promise<string>; id: string }>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
  responseConfig: IProviderResponseConfig,
): void {
  Deno.test(`${name} - token usage reporting`, async () => {
    const logger = new EventLogger({ prefix: "[Test]" });
    const infoSpy = spy(logger, "info");

    const provider = createProvider({ apiKey: "test-key" }, logger);
    const mockResponse = responseConfig.createFullResponse("Hello", 10, 20);

    const fetchStub = stubFetchSuccess(mockResponse);

    try {
      await provider.generate("Hi");
      if (infoSpy.calls.length === 0) {
        // Log diagnostics
        console.error("[DIAGNOSTIC] logger.info was not called");
        console.error("[DIAGNOSTIC] infoSpy.calls:", JSON.stringify(infoSpy.calls, null, 2));
        console.error("[DIAGNOSTIC] mockResponse:", JSON.stringify(mockResponse, null, 2));
        throw new Error("logger.info was not called during provider.generate. See diagnostics above.");
      }
      const call = infoSpy.calls[0];
      assertEquals(call.args[0], "llm.usage");
      assertEquals(call.args[1], provider.id);
      assertEquals(call.args[2]?.input_tokens, 10);
      assertEquals(call.args[2]?.output_tokens, 20);
    } finally {
      fetchStub.restore();
    }
  });
}

/**
 * Test retry behavior on 429 rate limit.
 */
export function testProviderRetryOn429<T extends { generate: (prompt: string) => Promise<string> }>(
  name: string,
  createProvider: (options?: JSONObject, logger?: EventLogger) => T,
  responseConfig: IProviderResponseConfig,
): void {
  Deno.test(`${name} - retry on 429`, async () => {
    const provider = createProvider({ apiKey: "test-key", retryDelayMs: 1 });

    let callCount = 0;
    const fetchStub = stub(globalThis, "fetch", () => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ error: { message: "Rate limit" } }), { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(responseConfig.createFullResponse("Success after retry", 0, 0)), { status: 200 }),
      );
    });

    try {
      const result = await provider.generate("Hi");
      assertEquals(result, "Success after retry");
      assertEquals(callCount, 2);
    } finally {
      fetchStub.restore();
    }
  });
}

/**
 * Register all standard provider tests.
 * Call this from each provider's test file for consistent coverage.
 */
export function registerProviderTests<
  T extends {
    id: string;
    generate: (prompt: string, options?: JSONObject) => Promise<string>;
  },
>(config: ProviderTestSuiteConfig<T>): void {
  testProviderInitialization(config.name, config.createProvider, config.defaultId);
  testProviderGenerateSuccess(config.name, config.createProvider, config.responseConfig, `Hello from ${config.name}`);
  testProviderHeaders(
    config.name,
    config.createProvider,
    config.responseConfig,
    config.apiKeyHeader,
    config.apiKeyValue,
    config.additionalHeaders,
  );
  testProviderErrorHandling(config.name, config.createProvider);
  testProviderOptionsMapping(
    config.name,
    config.createProvider,
    config.responseConfig,
    config.stopSequenceKey || "stop",
  );
  testProviderTokenUsage(config.name, config.createProvider, config.responseConfig);
  testProviderRetryOn429(config.name, config.createProvider, config.responseConfig);
}
