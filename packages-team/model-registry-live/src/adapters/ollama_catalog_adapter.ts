/**
 * @module OllamaCatalogAdapter
 * @path packages-team/model-registry-live/src/adapters/ollama_catalog_adapter.ts
 * @description Phase 135 Step 4 (§6.3) — the Ollama provider-catalog adapter. Maps GET
 *   /api/tags: details.parameter_size/quantization_level/family; the list omits
 *   context, so the window is enriched from the static overlay. fetchPricing prices
 *   every local model at $0 (endpoint provenance). No credential (local instance).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, zod]
 * @related-files [packages/model-registry/src/static_overlay.ts, packages-team/model-registry-live/src/adapters/catalog_fetch.ts]
 */
import { z } from "zod";
import {
  getOverlayEntry,
  type IAdapterContext,
  type ICatalogEntry,
  type IPricingEntry,
  type IProviderCatalogAdapter,
} from "@exaix/model-registry";
import { fetchAndParse } from "./catalog_fetch.ts";

const OLLAMA_PROVIDER = "ollama";
const TAGS_PATH = "/api/tags";
const LOCAL_PRICE = 0;

const OllamaModelSchema = z.object({
  name: z.string(),
  details: z.object({
    parameter_size: z.string().nullish(),
    quantization_level: z.string().nullish(),
    family: z.string().nullish(),
  }).nullish(),
});

const OllamaResponseSchema = z.object({ models: z.array(OllamaModelSchema) });

type OllamaModel = z.infer<typeof OllamaModelSchema>;

export class OllamaCatalogAdapter implements IProviderCatalogAdapter {
  readonly provider = OLLAMA_PROVIDER;

  async fetchCatalog(ctx: IAdapterContext): Promise<ICatalogEntry[]> {
    const models = await this.fetchModels(ctx);
    return models.map((m) => this.toCatalogEntry(m));
  }

  async fetchPricing(ctx: IAdapterContext): Promise<IPricingEntry[]> {
    const models = await this.fetchModels(ctx);
    const source = `${ctx.baseUrl}${TAGS_PATH}`;
    return models.map((m) => ({
      model: m.name,
      inputPerMtok: LOCAL_PRICE,
      outputPerMtok: LOCAL_PRICE,
      sourceUrl: source,
    }));
  }

  private async fetchModels(ctx: IAdapterContext): Promise<OllamaModel[]> {
    const parsed = await fetchAndParse(this.provider, ctx, TAGS_PATH, "none", OllamaResponseSchema);
    return parsed.models;
  }

  private toCatalogEntry(m: OllamaModel): ICatalogEntry {
    const overlay = getOverlayEntry(this.provider, m.name);
    return {
      model: m.name,
      contextWindow: overlay?.contextWindow,
      maxOutputTokens: overlay?.maxOutputTokens,
      rawCapabilities: m,
    };
  }
}
