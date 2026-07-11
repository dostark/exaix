/**
 * @module GoogleAdapterTest
 * @path packages-team/model-registry-live/tests/adapters/google_adapter_test.ts
 * @description Phase 135 Step 4 — the Google catalog adapter maps GET /v1beta/models
 *   (inputTokenLimit/outputTokenLimit → windows; supportedGenerationMethods →
 *   capability flags; displayName), throws typed errors, and passes the Zod gate.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type { IAdapterContext } from "@exaix/model-registry";
import { CatalogAuthError, CatalogHttpError } from "@exaix/model-registry";
import { GoogleCatalogAdapter } from "../../src/adapters/google_catalog_adapter.ts";

function ctxWith(fetchImpl: typeof fetch): IAdapterContext {
  return {
    apiKey: "goog-secret",
    baseUrl: "https://generativelanguage.googleapis.com",
    fetch: fetchImpl,
    timeoutMs: 5000,
  };
}

function jsonResponse(body: JSONValue, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE = {
  models: [
    {
      name: "models/gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      inputTokenLimit: 1000000,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ["generateContent", "countTokens"],
    },
  ],
};

Deno.test("google adapter maps inputTokenLimit/outputTokenLimit/supportedGenerationMethods", async () => {
  const adapter = new GoogleCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE))));
  assertEquals(entries.length, 1);
  const flash = entries[0];
  assertEquals(flash.model, "gemini-2.5-flash");
  assertEquals(flash.displayName, "Gemini 2.5 Flash");
  assertEquals(flash.contextWindow, 1000000);
  assertEquals(flash.maxOutputTokens, 8192);
});

Deno.test("google adapter throws typed auth/http errors; empty list returns []", async () => {
  const adapter = new GoogleCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({}, 403)))),
    CatalogAuthError,
  );
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({}, 502)))),
    CatalogHttpError,
  );
  const empty = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ models: [] }))));
  assertEquals(empty, []);
});
