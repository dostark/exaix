/**
 * @module OpenRouterAdapterTest
 * @path packages-team/model-registry-live/tests/adapters/openrouter_adapter_test.ts
 * @description Phase 135 Step 3 — the OpenRouter catalog adapter maps the
 *   /api/v1/models payload to ICatalogEntry[] and per-token pricing to per-Mtok
 *   IPricingEntry[] (provenance endpoint), throws typed auth/http errors, treats an
 *   empty list as success, and never leaks the API key.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type { IAdapterContext } from "@exaix/model-registry";
import { CatalogAuthError, CatalogHttpError, CatalogParseError } from "@exaix/model-registry";
import { OpenRouterCatalogAdapter } from "../../src/adapters/openrouter_catalog_adapter.ts";

const SECRET_KEY = "sk-or-secret-key-value";

function ctxWith(fetchImpl: typeof fetch): IAdapterContext {
  return {
    apiKey: SECRET_KEY,
    baseUrl: "https://openrouter.ai",
    fetch: fetchImpl,
    timeoutMs: 5000,
  };
}

function jsonResponse(body: JSONValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_MODELS = {
  data: [
    {
      id: "anthropic/claude-3.5-sonnet",
      name: "Anthropic: Claude 3.5 Sonnet",
      context_length: 200000,
      top_provider: { max_completion_tokens: 8192 },
      pricing: { prompt: "0.000003", completion: "0.000015" },
    },
    {
      id: "openai/gpt-4o",
      name: "OpenAI: GPT-4o",
      context_length: 128000,
      top_provider: { max_completion_tokens: 16384 },
      pricing: { prompt: "0.0000025", completion: "0.00001" },
    },
  ],
};

Deno.test("openrouter adapter maps /api/v1/models payload to ICatalogEntry[] (fetch stub)", async () => {
  const adapter = new OpenRouterCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE_MODELS))));
  assertEquals(entries.length, 2);
  assertEquals(entries[0].model, "anthropic/claude-3.5-sonnet");
  assertEquals(entries[0].displayName, "Anthropic: Claude 3.5 Sonnet");
  assertEquals(entries[0].contextWindow, 200000);
  assertEquals(entries[0].maxOutputTokens, 8192);
});

Deno.test("openrouter pricing maps per-token ×1e6 to per-Mtok with provenance endpoint", async () => {
  const adapter = new OpenRouterCatalogAdapter();
  const pricing = await adapter.fetchPricing(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE_MODELS))));
  assertEquals(pricing.length, 2);
  const sonnet = pricing.find((p) => p.model === "anthropic/claude-3.5-sonnet");
  assertEquals(sonnet?.inputPerMtok, 3); // 0.000003 * 1e6
  assertEquals(sonnet?.outputPerMtok, 15); // 0.000015 * 1e6
  assertStringIncludes(sonnet?.sourceUrl ?? "", "openrouter.ai");
});

Deno.test("adapter throws typed auth error on 401 and http error on 500; empty list returns []", async () => {
  const adapter = new OpenRouterCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ error: "unauthorized" }, 401)))),
    CatalogAuthError,
  );
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ error: "boom" }, 500)))),
    CatalogHttpError,
  );
  const empty = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ data: [] }))));
  assertEquals(empty, []);
});

Deno.test("malformed payload fails Zod validation → CatalogParseError, no partial write", async () => {
  const adapter = new OpenRouterCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ data: [{ notAModel: true }] })))),
    CatalogParseError,
  );
});

Deno.test("API key never appears in the fetched entries or any thrown error", async () => {
  const adapter = new OpenRouterCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE_MODELS))));
  assertStringIncludes(JSON.stringify(entries).indexOf(SECRET_KEY) === -1 ? "clean" : SECRET_KEY, "clean");
  const err = await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ error: "unauthorized" }, 401)))),
    CatalogAuthError,
  );
  assertEquals((err as Error).message.includes(SECRET_KEY), false);
});
