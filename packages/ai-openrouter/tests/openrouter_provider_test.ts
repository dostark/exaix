/**
 * @module OpenRouterProviderTest
 * @path packages/ai-openrouter/tests/openrouter_provider_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_factory.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @description Phase 80 Step 4 — validates the OpenRouterProvider (OpenAI-compatible gateway
 * call with HTTP-Referer/X-Title headers, response parsed into IGenerateResult) and the
 * OpenRouterProviderFactory (API-key resolution and actionable failure when the key is missing).
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ProviderType } from "@exaix/core";
import { AuthenticationError, ConnectionError } from "@exaix/ai/providers";
import { ProviderCallPolicyError } from "@exaix/ai/errors.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import {
  type IOpenRouterModelEntry,
  OPENROUTER_DEFAULT_SITE_NAME,
  OPENROUTER_DEFAULT_SITE_URL,
  OPENROUTER_PROVIDER_METADATA,
  OpenRouterBillingError,
  OpenRouterProvider,
  OpenRouterProviderFactory,
  OpenRouterRoutingError,
} from "@exaix/ai-openrouter";

const OPENAI_RESPONSE = JSON.stringify({
  choices: [{ message: { content: "hi from openrouter" } }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
});

Deno.test("OpenRouterProvider.generate posts to the gateway with auth + ranking headers", async () => {
  let capturedUrl = "";
  let headers = new Headers();
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    headers = new Headers(init?.headers);
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;

  try {
    const provider = new OpenRouterProvider({ apiKey: "sk-test", model: "anthropic/claude-3-opus" });
    const result = await provider.generate("hi");

    assertStringIncludes(capturedUrl, "openrouter.ai/api/v1/chat/completions");
    assertEquals(headers.get("Authorization"), "Bearer sk-test");
    assertEquals(headers.get("HTTP-Referer"), OPENROUTER_DEFAULT_SITE_URL);
    assertEquals(headers.get("X-Title"), OPENROUTER_DEFAULT_SITE_NAME);
    assertEquals(result.content, "hi from openrouter");
    assertEquals(result.usage.totalTokens, 7);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("OpenRouterProvider exposes an IModelProvider surface", () => {
  const provider = new OpenRouterProvider({ apiKey: "sk-test", model: "openai/gpt-4" });
  assertEquals(typeof provider.generate, "function");
  assertStringIncludes(provider.id, "openrouter");
});

Deno.test("OpenRouterProviderFactory.create returns a provider when an API key is supplied", async () => {
  const factory = new OpenRouterProviderFactory();
  const provider = await factory.create({
    provider: ProviderType.OPENROUTER,
    model: "anthropic/claude-3-opus",
    apiKey: "sk-test",
    timeoutMs: 60_000,
  });
  assert(provider instanceof OpenRouterProvider);
});

Deno.test("OpenRouterProviderFactory.create throws when the API key is missing", async () => {
  Deno.env.delete("OPENROUTER_API_KEY");
  const factory = new OpenRouterProviderFactory();
  await assertRejects(
    () => factory.create({ provider: ProviderType.OPENROUTER, model: "anthropic/claude-3-opus", timeoutMs: 60_000 }),
    Error,
    "OPENROUTER_API_KEY",
  );
});

Deno.test("OPENROUTER_PROVIDER_METADATA describes the openrouter provider", () => {
  assertEquals(OPENROUTER_PROVIDER_METADATA.name, "openrouter");
  assert(OPENROUTER_PROVIDER_METADATA.capabilities.includes("multi-model"));
});

Deno.test("OpenRouterProvider metadata advertises no unimplemented capabilities", () => {
  const provider: IModelProvider = new OpenRouterProvider({ apiKey: "sk-test", model: "openai/gpt-4" });
  const capabilities = OPENROUTER_PROVIDER_METADATA.capabilities as readonly string[];
  if (capabilities.includes("streaming")) {
    assertEquals(typeof provider.generateStream, "function");
  }
});

Deno.test("OpenRouterProvider.generate maps a 401 to AuthenticationError", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("unauthorized", { status: 401 }))) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({ apiKey: "sk-test", model: "openai/gpt-4" });
    await assertRejects(() => provider.generate("hi"), AuthenticationError);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("[openrouter] routing block serialized into request body", async () => {
  let capturedBody = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;

  try {
    const provider = new OpenRouterProvider({
      apiKey: "sk-test",
      model: "openai/gpt-4o",
      routing: {
        models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
        provider: {
          order: ["OpenAI", "Anthropic"],
          sort: "cost",
        },
        zdr: true,
        data_collection: "deny",
      },
    });
    await provider.generate("test prompt");

    const body = JSON.parse(capturedBody);
    assertEquals(body.model, "openai/gpt-4o");
    assertEquals(body.messages[0].content, "test prompt");
    assertEquals(body.models, ["openai/gpt-4o", "anthropic/claude-sonnet-4"]);
    assertEquals(body.provider.order, ["OpenAI", "Anthropic"]);
    assertEquals(body.provider.sort, "cost");
    assertEquals(body.provider.zdr, true);
    assertEquals(body.provider.data_collection, "deny");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("[openrouter] routing block serializes max_price into request body", async () => {
  let capturedBody = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;

  try {
    const provider = new OpenRouterProvider({
      apiKey: "sk-test",
      model: "openai/gpt-4o",
      routing: {
        provider: {
          max_price: { prompt: 2, completion: 1, request: 0.01, image: 0.005 },
        },
      },
    });
    await provider.generate("test prompt");

    const body = JSON.parse(capturedBody);
    assertEquals(body.provider.max_price.prompt, 2);
    assertEquals(body.provider.max_price.completion, 1);
    assertEquals(body.provider.max_price.request, 0.01);
    assertEquals(body.provider.max_price.image, 0.005);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("[openrouter] routing block omitted when not configured", async () => {
  let capturedBody = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;

  try {
    const provider = new OpenRouterProvider({
      apiKey: "sk-test",
      model: "openai/gpt-4o",
    });
    await provider.generate("test prompt");

    const body = JSON.parse(capturedBody);
    assertEquals(body.model, "openai/gpt-4o");
    assertEquals(body.models, undefined);
    assertEquals(body.provider, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});

const RETRY_DELAY_MS = 1;

async function countFetchesForStatus(
  status: number,
  body: string,
): Promise<{ calls: number; error: Error }> {
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({ apiKey: "sk-test", model: "openai/gpt-4", retryDelayMs: RETRY_DELAY_MS });
    try {
      await provider.generate("hi");
    } catch (error) {
      return { calls, error: error as Error };
    }
    throw new Error("generate did not throw");
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("OpenRouterProvider fetches a routing 404 once and throws the typed routing error", async () => {
  const { calls, error } = await countFetchesForStatus(
    404,
    JSON.stringify({ error: { code: 404, message: "No endpoints found that can handle the requested parameters." } }),
  );
  assertEquals(calls, 1);
  assert(error instanceof OpenRouterRoutingError);
});

Deno.test("OpenRouterProvider fetches a 402 once and throws the typed billing error", async () => {
  const { calls, error } = await countFetchesForStatus(
    402,
    JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }),
  );
  assertEquals(calls, 1);
  assert(error instanceof OpenRouterBillingError);
});

Deno.test("OpenRouterProvider retries a 503 even when the message names routing requirements (Q10)", async () => {
  const { calls, error } = await countFetchesForStatus(
    503,
    JSON.stringify({ error: { code: 503, message: "No provider meets the routing requirements" } }),
  );
  assert(calls > 1, `a 503 must be retried, got ${calls} fetch(es)`);
  assert(error instanceof ConnectionError);
});

Deno.test("OpenRouterProvider sends no metadata opt-in header, because no consumer reads openrouter_metadata", async () => {
  let headers = new Headers();
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({ apiKey: "sk-test", model: "openai/gpt-4" });
    await provider.generate("hi");
    assertEquals(headers.get("X-OpenRouter-Metadata"), null);
    assertEquals(headers.get("X-OpenRouter-Experimental-Metadata"), null);
  } finally {
    globalThis.fetch = origFetch;
  }
});

const TOOL = { name: "read_file", inputSchema: { type: "object" } };

function capabilitySource(
  entry: IOpenRouterModelEntry | undefined,
): { getEntry: () => Promise<IOpenRouterModelEntry | undefined>; calls: () => number } {
  let calls = 0;
  return {
    getEntry: () => {
      calls++;
      return Promise.resolve(entry);
    },
    calls: () => calls,
  };
}

async function generateWithCapabilities(
  entry: IOpenRouterModelEntry | undefined,
  options: { tools?: Array<typeof TOOL> },
): Promise<{ chatFetches: number; lookups: number; error?: Error }> {
  let chatFetches = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    chatFetches++;
    return Promise.resolve(new Response(OPENAI_RESPONSE, { status: 200 }));
  }) as typeof fetch;
  const source = capabilitySource(entry);
  try {
    const provider = new OpenRouterProvider({ apiKey: "sk-test", model: "qwen/qwen3.7-flash", capabilities: source });
    try {
      await provider.generate("hi", options);
      return { chatFetches, lookups: source.calls() };
    } catch (error) {
      return { chatFetches, lookups: source.calls(), error: error as Error };
    }
  } finally {
    globalThis.fetch = origFetch;
  }
}

const entryWith = (supportedParameters: string[]): IOpenRouterModelEntry => ({
  id: "qwen/qwen3.7-flash",
  supportedParameters,
});

Deno.test("a tool-using request on a model without tools throws ProviderCallPolicyError before the chat fetch", async () => {
  const result = await generateWithCapabilities(entryWith(["response_format"]), { tools: [TOOL] });
  assertEquals(result.chatFetches, 0);
  assert(result.error instanceof ProviderCallPolicyError);
  assertEquals(result.error.reasonCode, "unsupported_call_option");
});

Deno.test("a tool-using request on a model with tools is not refused", async () => {
  const result = await generateWithCapabilities(entryWith(["tools"]), { tools: [TOOL] });
  assertEquals(result.error, undefined);
  assertEquals(result.chatFetches, 1);
});

Deno.test("an unknown model is not refused", async () => {
  const result = await generateWithCapabilities(undefined, { tools: [TOOL] });
  assertEquals(result.error, undefined);
  assertEquals(result.chatFetches, 1);
});

Deno.test("a request without tools never consults the capability source", async () => {
  const result = await generateWithCapabilities(entryWith([]), {});
  assertEquals(result.lookups, 0);
  assertEquals(result.chatFetches, 1);
});

Deno.test("an empty tools array does not consult the capability source", async () => {
  const result = await generateWithCapabilities(entryWith([]), { tools: [] });
  assertEquals(result.lookups, 0);
});
