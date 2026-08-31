/**
 * @module AnthropicCatalogAdapter
 * @path packages-team/model-registry-live/src/adapters/anthropic_catalog_adapter.ts
 * @description Phase 135 Step 4 (§6.3) — the Anthropic provider-catalog adapter. Maps
 *   GET /v1/models: capabilities.thinking/effort → supports flags; max_input_tokens/
 *   max_tokens → windows (0/absent left unset → falls to the overlay per the §9 caveat);
 *   created_at → releasedAt. No fetchPricing (prices come from the static catalog).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, zod]
 * @related-files [packages-team/model-registry-live/src/adapters/catalog_fetch.ts]
 */
import { z } from "zod";
import type { IAdapterContext, ICatalogEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import type { Opt, Reason } from "@exaix/core/types";
import { fetchAndParse } from "./catalog_fetch.ts";

const ANTHROPIC_PROVIDER = "anthropic";
const MODELS_PATH = "/v1/models";

const AnthropicModelSchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  created_at: z.string().optional(),
  max_input_tokens: z.number().nullish(),
  max_tokens: z.number().nullish(),
  capabilities: z.object({
    thinking: z.object({ supported: z.boolean() }).nullish(),
    effort: z.object({ supported: z.boolean() }).nullish(),
  }).nullish(),
});

const AnthropicResponseSchema = z.object({ data: z.array(AnthropicModelSchema) });

type AnthropicModel = z.infer<typeof AnthropicModelSchema>;

/** 0 or absent → unknown; leave undefined so the overlay fills it. */
function positiveOrUndefined(value: Opt<number | null, Reason.OptionalInput>): number | undefined {
  return value != null && value > 0 ? value : undefined;
}

export class AnthropicCatalogAdapter implements IProviderCatalogAdapter {
  readonly provider = ANTHROPIC_PROVIDER;

  async fetchCatalog(ctx: IAdapterContext): Promise<ICatalogEntry[]> {
    const parsed = await fetchAndParse(this.provider, ctx, MODELS_PATH, "x-api-key", AnthropicResponseSchema);
    return parsed.data.map((m) => this.toCatalogEntry(m));
  }

  private toCatalogEntry(m: AnthropicModel): ICatalogEntry {
    const releasedAt = m.created_at ? Date.parse(m.created_at) : undefined;
    return {
      model: m.id,
      displayName: m.display_name ?? undefined,
      contextWindow: positiveOrUndefined(m.max_input_tokens),
      maxOutputTokens: positiveOrUndefined(m.max_tokens),
      supportsThinking: m.capabilities?.thinking?.supported ?? undefined,
      supportsEffort: m.capabilities?.effort?.supported ?? undefined,
      releasedAt: Number.isNaN(releasedAt) ? undefined : releasedAt,
      rawCapabilities: m,
    };
  }
}
