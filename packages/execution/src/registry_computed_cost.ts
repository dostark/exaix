/**
 * @module RegistryComputedCost
 * @path packages/execution/src/registry_computed_cost.ts
 * @description Prices supplied token counts using the static overlay or a model catalog.
 * ReAct supplies measured usage. Prompt previews supply estimated input tokens and zero output tokens.
 * Costs remain predicted. This module never produces a tracked figure.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/model-registry/src/static_overlay.ts]
 */

import { getOverlayEntry } from "@exaix/model-registry";
import { TOKENS_PER_MTOK } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

interface IRegistryPredictedCostTokens {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface IRegistryPredictedCostPrice {
  inputPerMtok?: number;
  outputPerMtok?: number;
}

/** Anthropic's documented prompt-cache read discount: a cache hit costs 10% of the standard
 *  input price. https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching */
const CACHE_READ_PRICE_MULTIPLIER = 0.1;

/** True when the entry carries at least one price. */
function hasAnyRate(entry: IRegistryPredictedCostPrice): boolean {
  return entry.inputPerMtok !== undefined || entry.outputPerMtok !== undefined;
}

/** The overlay prices when the overlay has any, otherwise the supplied catalog prices. */
function ratesFor(
  provider: string,
  model: string,
  price: Opt<IRegistryPredictedCostPrice, Reason.OptionalContext>,
): IRegistryPredictedCostPrice | undefined {
  const overlay = getOverlayEntry(provider, model);
  if (overlay && hasAnyRate(overlay)) return overlay;
  return price && hasAnyRate(price) ? price : undefined;
}

/** True when the tokens include a kind that the rates leave unpriced. */
function lacksRequiredRate(tokens: IRegistryPredictedCostTokens, rates: IRegistryPredictedCostPrice): boolean {
  const hasInputTokens = tokens.promptTokens > 0 || (tokens.cacheReadTokens ?? 0) > 0 ||
    (tokens.cacheCreationTokens ?? 0) > 0;
  return (hasInputTokens && rates.inputPerMtok === undefined) ||
    (tokens.completionTokens > 0 && rates.outputPerMtok === undefined);
}

/** The cost of the tokens at the rates. A missing rate counts as zero. */
function priceTokens(tokens: IRegistryPredictedCostTokens, rates: IRegistryPredictedCostPrice): number {
  const inputRate = rates.inputPerMtok ?? 0;
  const outputRate = rates.outputPerMtok ?? 0;
  const promptCost = (tokens.promptTokens * inputRate) / TOKENS_PER_MTOK;
  const completionCost = (tokens.completionTokens * outputRate) / TOKENS_PER_MTOK;
  const cacheReadCost = ((tokens.cacheReadTokens ?? 0) * inputRate * CACHE_READ_PRICE_MULTIPLIER) /
    TOKENS_PER_MTOK;
  const cacheCreationCost = ((tokens.cacheCreationTokens ?? 0) * inputRate) / TOKENS_PER_MTOK;
  return promptCost + completionCost + cacheReadCost + cacheCreationCost;
}

/** Cache-creation tokens cost the standard input rate, and cache-read tokens get the 0.1x discount.
 *  Returns undefined when neither the overlay nor the supplied catalog entry has a price. */
export function computeRegistryPredictedCost(
  provider: string,
  model: string,
  tokens: IRegistryPredictedCostTokens,
  price?: Opt<IRegistryPredictedCostPrice, Reason.OptionalContext>,
): number | undefined {
  const rates = ratesFor(provider, model, price);
  if (!rates || lacksRequiredRate(tokens, rates)) return undefined;
  return priceTokens(tokens, rates);
}
