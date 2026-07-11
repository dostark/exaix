/**
 * @module GoogleCatalogAdapter
 * @path packages-team/model-registry-live/src/adapters/google_catalog_adapter.ts
 * @description Phase 135 Step 4 (§6.3) — the Google provider-catalog adapter. Maps GET
 *   /v1beta/models: inputTokenLimit → context_window; outputTokenLimit →
 *   max_output_tokens; supportedGenerationMethods → capability flags; displayName. The
 *   "models/" name prefix is stripped. No fetchPricing (prices come from the overlay).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, zod]
 * @related-files [packages-team/model-registry-live/src/adapters/catalog_fetch.ts]
 */
import { z } from "zod";
import type { IAdapterContext, ICatalogEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import { fetchAndParse } from "./catalog_fetch.ts";

const GOOGLE_PROVIDER = "google";
const MODELS_PATH = "/v1beta/models";
const NAME_PREFIX = "models/";

const GoogleModelSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  inputTokenLimit: z.number().nullish(),
  outputTokenLimit: z.number().nullish(),
  supportedGenerationMethods: z.array(z.string()).nullish(),
});

const GoogleResponseSchema = z.object({ models: z.array(GoogleModelSchema) });

type GoogleModel = z.infer<typeof GoogleModelSchema>;

export class GoogleCatalogAdapter implements IProviderCatalogAdapter {
  readonly provider = GOOGLE_PROVIDER;

  async fetchCatalog(ctx: IAdapterContext): Promise<ICatalogEntry[]> {
    const parsed = await fetchAndParse(this.provider, ctx, MODELS_PATH, "x-api-key", GoogleResponseSchema);
    return parsed.models.map((m) => this.toCatalogEntry(m));
  }

  private toCatalogEntry(m: GoogleModel): ICatalogEntry {
    const model = m.name.startsWith(NAME_PREFIX) ? m.name.slice(NAME_PREFIX.length) : m.name;
    return {
      model,
      displayName: m.displayName ?? undefined,
      contextWindow: m.inputTokenLimit ?? undefined,
      maxOutputTokens: m.outputTokenLimit ?? undefined,
      rawCapabilities: m,
    };
  }
}
