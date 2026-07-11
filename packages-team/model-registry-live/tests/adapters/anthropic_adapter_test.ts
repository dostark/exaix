/**
 * @module AnthropicAdapterTest
 * @path packages-team/model-registry-live/tests/adapters/anthropic_adapter_test.ts
 * @description Phase 135 Step 4 — the Anthropic catalog adapter maps GET /v1/models
 *   (capabilities.thinking/effort → flags; max_input_tokens/max_tokens → windows,
 *   0/absent falling to the overlay per the §9 caveat; created_at → releasedAt),
 *   throws typed auth/http errors, and passes the Zod gate.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type { IAdapterContext } from "@exaix/model-registry";
import { CatalogAuthError, CatalogHttpError, CatalogParseError } from "@exaix/model-registry";
import { AnthropicCatalogAdapter } from "../../src/adapters/anthropic_catalog_adapter.ts";

function ctxWith(fetchImpl: typeof fetch): IAdapterContext {
  return { apiKey: "sk-ant-secret", baseUrl: "https://api.anthropic.com", fetch: fetchImpl, timeoutMs: 5000 };
}

function jsonResponse(body: JSONValue, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE = {
  data: [
    {
      id: "claude-opus-4-8",
      display_name: "Claude Opus 4.8",
      created_at: "2026-01-15T00:00:00Z",
      max_input_tokens: 200000,
      max_tokens: 8192,
      capabilities: { thinking: { supported: true }, effort: { supported: true } },
    },
    {
      id: "claude-thin",
      display_name: "Claude Thin",
      created_at: "2026-02-01T00:00:00Z",
      max_input_tokens: 0, // §9 caveat: 0 → unknown, falls to overlay
      max_tokens: 0,
      capabilities: { thinking: { supported: false }, effort: { supported: false } },
    },
  ],
};

Deno.test("anthropic adapter maps capabilities/windows and created_at → releasedAt", async () => {
  const adapter = new AnthropicCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE))));
  assertEquals(entries.length, 2);
  const opus = entries[0];
  assertEquals(opus.model, "claude-opus-4-8");
  assertEquals(opus.displayName, "Claude Opus 4.8");
  assertEquals(opus.contextWindow, 200000);
  assertEquals(opus.maxOutputTokens, 8192);
  assertEquals(opus.supportsThinking, true);
  assertEquals(opus.supportsEffort, true);
  assertEquals(opus.releasedAt, Date.parse("2026-01-15T00:00:00Z"));
});

Deno.test("anthropic max_input_tokens 0/absent leaves window unset (§9 caveat: falls to overlay)", async () => {
  const adapter = new AnthropicCatalogAdapter();
  const entries = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse(SAMPLE))));
  const thin = entries[1];
  assertEquals(thin.contextWindow, undefined);
  assertEquals(thin.maxOutputTokens, undefined);
});

Deno.test("anthropic adapter throws typed auth error on 401 and http error on 500; empty list returns []", async () => {
  const adapter = new AnthropicCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ error: "x" }, 401)))),
    CatalogAuthError,
  );
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ error: "x" }, 500)))),
    CatalogHttpError,
  );
  const empty = await adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ data: [] }))));
  assertEquals(empty, []);
});

Deno.test("anthropic malformed payload fails the Zod gate with a CatalogParseError", async () => {
  const adapter = new AnthropicCatalogAdapter();
  await assertRejects(
    () => adapter.fetchCatalog(ctxWith(() => Promise.resolve(jsonResponse({ data: [{ no_id: true }] })))),
    CatalogParseError,
  );
});
