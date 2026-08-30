/**
 * @module IProviderCatalogAdapter
 * @path packages/model-registry/src/adapters/i_provider_catalog_adapter.ts
 * @description Phase 135 Step 3 (§6.1) — the pure provider-catalog adapter contract.
 *   Solo-owned (no runtime deps) so both the Solo package and the Team live registry
 *   share one type surface. An adapter fetches a provider's model list + capabilities
 *   (and, if the provider exposes a price endpoint, per-model pricing). Concrete
 *   adapters live in packages-team/model-registry-live; admission/persistence is the
 *   registry's job, not the adapter's (§5.9).
 * @architectural-layer ModelRegistry
 * @dependencies [@exaix/core]
 * @related-files [packages-team/model-registry-live/src/adapters/openrouter_catalog_adapter.ts]
 */
import type { JSONValue } from "@exaix/core";

/** Runtime context handed to an adapter for one fetch with injected fetch and timeout. */
export interface IAdapterContext {
  apiKey?: string;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
}

/** One catalog row as an adapter reports it, before admission/persistence. */
export interface ICatalogEntry {
  model: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  releasedAt?: number;
  /** Raw provider capability blob, stored in capabilities_json for forward-compat. */
  rawCapabilities?: JSONValue;
}

/** One pricing row as an adapter reports it (per-Mtok, endpoint provenance). */
export interface IPricingEntry {
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  /** Doc/endpoint the price came from (audit provenance). */
  sourceUrl: string;
}

export interface IProviderCatalogAdapter {
  /** Provider type this adapter serves (matches the ProviderRegistry key). */
  readonly provider: string;

  /** Fetch current model list and capabilities. Returns [] on empty; throws CatalogError on failure. */
  fetchCatalog(ctx: IAdapterContext): Promise<ICatalogEntry[]>;

  /** Fetch per-model pricing if exposed by provider; falls back to static catalog if omitted. */
  fetchPricing?(ctx: IAdapterContext): Promise<IPricingEntry[]>;
}
