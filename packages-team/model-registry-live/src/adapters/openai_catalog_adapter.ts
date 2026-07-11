/**
 * @module OpenAiCatalogAdapter
 * @path packages-team/model-registry-live/src/adapters/openai_catalog_adapter.ts
 * @description Phase 135 Step 4 (§6.3) — the OpenAI provider-catalog adapter. The list
 *   endpoint (GET /v1/models) is thin (id + created only), so capabilities/windows are
 *   enriched from the 134 static overlay (§9: mandatory). `created` (seconds) →
 *   releasedAt (ms). No fetchPricing (prices come from the overlay).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, zod]
 * @related-files [packages/model-registry/src/static_overlay.ts, packages-team/model-registry-live/src/adapters/catalog_fetch.ts]
 */
import { z } from "zod";
import {
  getOverlayEntry,
  type IAdapterContext,
  type ICatalogEntry,
  type IProviderCatalogAdapter,
} from "@exaix/model-registry";
import { fetchAndParse } from "./catalog_fetch.ts";

const OPENAI_PROVIDER = "openai";
const MODELS_PATH = "/v1/models";
const SECONDS_TO_MS = 1000;

const OpenAiModelSchema = z.object({
  id: z.string(),
  created: z.number().nullish(),
});

const OpenAiResponseSchema = z.object({ data: z.array(OpenAiModelSchema) });

type OpenAiModel = z.infer<typeof OpenAiModelSchema>;

export class OpenAiCatalogAdapter implements IProviderCatalogAdapter {
  readonly provider = OPENAI_PROVIDER;

  async fetchCatalog(ctx: IAdapterContext): Promise<ICatalogEntry[]> {
    const parsed = await fetchAndParse(this.provider, ctx, MODELS_PATH, "bearer", OpenAiResponseSchema);
    return parsed.data.map((m) => this.toCatalogEntry(m));
  }

  private toCatalogEntry(m: OpenAiModel): ICatalogEntry {
    const overlay = getOverlayEntry(this.provider, m.id);
    return {
      model: m.id,
      contextWindow: overlay?.contextWindow,
      maxOutputTokens: overlay?.maxOutputTokens,
      supportsThinking: overlay?.supportsThinking,
      supportsEffort: overlay?.supportsEffort,
      releasedAt: m.created != null ? m.created * SECONDS_TO_MS : undefined,
      rawCapabilities: m,
    };
  }
}
