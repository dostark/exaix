/**
 * @module OpenAiAdapterTest
 * @path packages-team/model-registry-live/tests/adapters/openai_adapter_test.ts
 * @description Phase 135 Step 4 — the OpenAI catalog adapter maps GET /v1/models (a
 *   thin id/created list) and enriches capabilities/windows from the 134 static
 *   overlay (§9: mandatory). Throws typed errors and passes the Zod gate.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type { IAdapterContext } from "@exaix/model-registry";
import { CatalogAuthError, CatalogHttpError } from "@exaix/model-registry";
import { OpenAiCatalogAdapter } from "../../src/adapters/openai_catalog_adapter.ts";

function ctxWith(fetchImpl: typeof fetch): IAdapterContext {
  return { apiKey: "sk-openai-secret", baseUrl: "https://api.openai.com", fetch: fetchImpl, timeoutMs: 5000 };
}

function jsonResponse(body: JSONValue, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE = {
  data: [
    { id: "gpt-4o", object: "model", created: 1715000000 },
    { id: "gpt-4o-mini", object: "model", created: 1715000001 },
  ],
};

Deno.test("openai adapter returns thin entries enriched from the static overlay", async () => {
  const adapter = new OpenAiCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE))));
  const gpt4o = entries.find((e) => e.model === "gpt-4o");
  assertEquals(gpt4o?.contextWindow, 128000); // from STATIC_OVERLAY "openai:gpt-4o"
  // created seconds → releasedAt ms
  assertEquals(gpt4o?.releasedAt, 1715000000 * 1000);
});

Deno.test("openai adapter throws typed auth/http errors; empty list returns []", async () => {
  const adapter = new OpenAiCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({}, 401)))),
    CatalogAuthError,
  );
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({}, 500)))),
    CatalogHttpError,
  );
  const empty = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ data: [] }))));
  assertEquals(empty, []);
});
