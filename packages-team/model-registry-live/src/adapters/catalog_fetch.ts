/**
 * @module CatalogFetch
 * @path packages-team/model-registry-live/src/adapters/catalog_fetch.ts
 * @description Phase 135 Step 4 — shared GET + status-mapping + JSON + Zod helper for
 *   the provider catalog adapters, so each adapter maps only its own payload shape and
 *   the auth/http/parse error handling lives in one place (no duplicated fetch
 *   boilerplate across five adapters). The API key rides the Authorization header only;
 *   it never appears in a thrown error (§8.2).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, zod]
 * @related-files [packages/model-registry/src/adapters/i_provider_catalog_adapter.ts]
 */
import type { z } from "zod";
import type { JSONValue } from "@exaix/core";
import { CatalogAuthError, CatalogHttpError, CatalogParseError, type IAdapterContext } from "@exaix/model-registry";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** How the credential is presented on the request. */
export type AuthScheme = "bearer" | "x-api-key" | "none";

/**
 * GET `{baseUrl}{path}`, map non-2xx to a typed CatalogError, parse JSON, and validate
 * against `schema`. Returns the parsed value; throws CatalogAuth/Http/ParseError.
 */
export async function fetchAndParse<T>(
  provider: string,
  ctx: IAdapterContext,
  path: string,
  auth: AuthScheme,
  schema: z.ZodType<T>,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (ctx.apiKey && auth === "bearer") headers.authorization = `Bearer ${ctx.apiKey}`;
  if (ctx.apiKey && auth === "x-api-key") headers["x-api-key"] = ctx.apiKey;

  const res = await ctx.fetch(`${ctx.baseUrl}${path}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });

  if (res.status === HTTP_UNAUTHORIZED || res.status === HTTP_FORBIDDEN) {
    throw new CatalogAuthError(provider, res.status);
  }
  if (!res.ok) {
    throw new CatalogHttpError(provider, res.status);
  }

  let body: JSONValue;
  try {
    body = await res.json();
  } catch (e) {
    throw new CatalogParseError(provider, e instanceof Error ? e.message : "invalid JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new CatalogParseError(provider, parsed.error.issues[0]?.message ?? "schema mismatch");
  }
  return parsed.data;
}
