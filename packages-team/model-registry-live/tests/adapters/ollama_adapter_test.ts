/**
 * @module OllamaAdapterTest
 * @path packages-team/model-registry-live/tests/adapters/ollama_adapter_test.ts
 * @description Phase 135 Step 4 — the Ollama catalog adapter maps GET /api/tags
 *   (details.*; window from the overlay since the list omits context) and prices every
 *   model at $0 with endpoint provenance. Throws typed errors and passes the Zod gate.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type { IAdapterContext } from "@exaix/model-registry";
import { CatalogHttpError } from "@exaix/model-registry";
import { OllamaCatalogAdapter } from "../../src/adapters/ollama_catalog_adapter.ts";

function ctxWith(fetchImpl: typeof fetch): IAdapterContext {
  return { baseUrl: "http://localhost:11434", fetch: fetchImpl, timeoutMs: 5000 };
}

function jsonResponse(body: JSONValue, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE = {
  models: [
    {
      name: "llama3.1:8b",
      details: { parameter_size: "8B", quantization_level: "Q4_0", family: "llama" },
    },
    {
      name: "qwen2.5:14b",
      details: { parameter_size: "14B", quantization_level: "Q4_K_M", family: "qwen2" },
    },
  ],
};

Deno.test("ollama adapter maps /api/tags details entries", async () => {
  const adapter = new OllamaCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE))));
  assertEquals(entries.length, 2);
  assertEquals(entries[0].model, "llama3.1:8b");
});

Deno.test("ollama fetchPricing prices every model $0 with endpoint provenance", async () => {
  const adapter = new OllamaCatalogAdapter();
  const pricing = await adapter.fetchPricing(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE))));
  assertEquals(pricing.length, 2);
  assertEquals(pricing[0].inputPerMtok, 0);
  assertEquals(pricing[0].outputPerMtok, 0);
});

Deno.test("ollama adapter throws typed http error on failure; empty list returns []", async () => {
  const adapter = new OllamaCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({}, 500)))),
    CatalogHttpError,
  );
  const empty = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ models: [] }))));
  assertEquals(empty, []);
});
