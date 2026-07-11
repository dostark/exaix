/**
 * @module OpenRouterCatalogAdapter
 * @path packages-team/model-registry-live/src/adapters/openrouter_catalog_adapter.ts
 * @description Phase 135 Step 3 — the OpenRouter provider-catalog adapter. Fetches
 *   GET {base}/api/v1/models, Zod-validates the payload, and maps it to
 *   ICatalogEntry[] plus per-Mtok IPricingEntry[] (per-token prices ×1e6). Throws
 *   typed CatalogError subclasses on auth/HTTP/parse failure; an empty list is not an
 *   error. Reuses the provider's configured key + base URL via IAdapterContext — no new
 *   secret surface, and the key never appears in an error message (§8.2).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, zod]
 * @related-files [packages/model-registry/src/adapters/i_provider_catalog_adapter.ts]
 */
import { z } from "zod";
import type { IAdapterContext, ICatalogEntry, IPricingEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import { fetchAndParse } from "./catalog_fetch.ts";

const OPENROUTER_PROVIDER = "openrouter";
const MODELS_PATH = "/api/v1/models";
const PER_TOKEN_TO_PER_MTOK = 1_000_000;

const OpenRouterModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().nullish(),
  top_provider: z.object({
    max_completion_tokens: z.number().nullish(),
  }).nullish(),
  pricing: z.object({
    prompt: z.string().nullish(),
    completion: z.string().nullish(),
  }).nullish(),
});

const OpenRouterModelsResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;

export class OpenRouterCatalogAdapter implements IProviderCatalogAdapter {
  readonly provider = OPENROUTER_PROVIDER;

  async fetchCatalog(ctx: IAdapterContext): Promise<ICatalogEntry[]> {
    const models = await this.fetchModels(ctx);
    return models.map((m) => this.toCatalogEntry(m));
  }

  async fetchPricing(ctx: IAdapterContext): Promise<IPricingEntry[]> {
    const models = await this.fetchModels(ctx);
    const source = `${ctx.baseUrl}${MODELS_PATH}`;
    const entries: IPricingEntry[] = [];
    for (const m of models) {
      const input = m.pricing?.prompt;
      const output = m.pricing?.completion;
      if (input == null || output == null) continue;
      entries.push({
        model: m.id,
        inputPerMtok: Number(input) * PER_TOKEN_TO_PER_MTOK,
        outputPerMtok: Number(output) * PER_TOKEN_TO_PER_MTOK,
        sourceUrl: source,
      });
    }
    return entries;
  }

  private async fetchModels(ctx: IAdapterContext): Promise<OpenRouterModel[]> {
    const parsed = await fetchAndParse(this.provider, ctx, MODELS_PATH, "bearer", OpenRouterModelsResponseSchema);
    return parsed.data;
  }

  private toCatalogEntry(m: OpenRouterModel): ICatalogEntry {
    return {
      model: m.id,
      displayName: m.name ?? undefined,
      contextWindow: m.context_length ?? undefined,
      maxOutputTokens: m.top_provider?.max_completion_tokens ?? undefined,
      rawCapabilities: m,
    };
  }
}
