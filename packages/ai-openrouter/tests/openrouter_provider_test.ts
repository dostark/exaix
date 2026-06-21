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
import { AuthenticationError } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import {
  OPENROUTER_DEFAULT_SITE_NAME,
  OPENROUTER_DEFAULT_SITE_URL,
  OPENROUTER_PROVIDER_METADATA,
  OpenRouterProvider,
  OpenRouterProviderFactory,
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
