/**
 * @module CompatibleUsage
 * @path packages/ai/src/compatible_usage.ts
 * @description Prices reported compatible usage only with verified exact-model rates.
 * @architectural-layer AI
 * @dependencies [@exaix/core/types, @exaix/schemas]
 * @related-files [packages/ai-openai/src/openai_provider.ts]
 */
import type { IModelPricing, Opt, Reason } from "@exaix/core/types";
import { OPENAI_COMPATIBLE_UNPRICED_PROFILES } from "@exaix/core";
import type { CompatibleChatConfig } from "@exaix/schemas";
import type { IGenerateResult, ProviderCostStatus } from "./providers/common.ts";

export interface ICompatiblePrice {
  costStatus: ProviderCostStatus;
  cost_usd?: number;
}
const TOKENS_PER_MILLION = 1_000_000;

function validRate(rate: Opt<number, Reason.OptionalInput>): rate is number {
  return rate !== undefined && Number.isFinite(rate) && rate >= 0;
}

/** Cache and reasoning counters are subsets, never additional prompt/output tokens. */
export function priceCompatibleUsage(
  profile: CompatibleChatConfig["profile"],
  returnedModel: string,
  usage: IGenerateResult["usage"],
  pricing?: Opt<IModelPricing, Reason.OptionalInput>,
): ICompatiblePrice {
  const unpriced: ICompatiblePrice = { costStatus: "unknown" };
  if (
    OPENAI_COMPATIBLE_UNPRICED_PROFILES.includes(profile) || !pricing || pricing.provider !== profile ||
    pricing.model !== returnedModel ||
    pricing.provenance === "unknown" || !pricing.verifiedAt || !pricing.sourceUrl ||
    !validRate(pricing.inputPerMtok) || !validRate(pricing.outputPerMtok)
  ) return unpriced;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  if (
    (cacheRead > 0 && !validRate(pricing.cacheReadPerMtok)) ||
    (cacheWrite > 0 && !validRate(pricing.cacheCreationPerMtok)) ||
    cacheRead + cacheWrite > usage.promptTokens
  ) return unpriced;
  const cost = ((usage.promptTokens - cacheRead - cacheWrite) * pricing.inputPerMtok +
    cacheRead * (pricing.cacheReadPerMtok ?? 0) + cacheWrite * (pricing.cacheCreationPerMtok ?? 0) +
    usage.completionTokens * pricing.outputPerMtok) / TOKENS_PER_MILLION;
  return { costStatus: "estimated", cost_usd: cost };
}
