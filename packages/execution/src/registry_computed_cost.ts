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
import type { Opt, Reason } from "@exaix/core/types";

export interface IRegistryPredictedCostTokens {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface IRegistryPredictedCostPrice {
  inputPerMtok?: number;
  outputPerMtok?: number;
}

const TOKENS_PER_MTOK = 1_000_000;
/** Anthropic's documented prompt-cache read discount: a cache hit costs 10% of the standard
 *  input price. https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching */
const CACHE_READ_PRICE_MULTIPLIER = 0.1;

/** Cache-creation tokens are priced at the standard input rate (no per-tier cache-write
 *  multiplier in the overlay table yet); cache-read tokens get the 0.1x discount. Returns
 *  undefined when neither the overlay nor the supplied catalog entry has a price. */
export function computeRegistryPredictedCost(
  provider: string,
  model: string,
  tokens: IRegistryPredictedCostTokens,
  price?: Opt<IRegistryPredictedCostPrice, Reason.OptionalContext>,
): number | undefined {
  const overlay = getOverlayEntry(provider, model);
  const rates = overlay && (overlay.inputPerMtok !== undefined || overlay.outputPerMtok !== undefined)
    ? overlay
    : price;
  if (!rates || (rates.inputPerMtok === undefined && rates.outputPerMtok === undefined)) {
    return undefined;
  }

  const hasInputTokens = tokens.promptTokens > 0 || (tokens.cacheReadTokens ?? 0) > 0 ||
    (tokens.cacheCreationTokens ?? 0) > 0;
  if (
    (hasInputTokens && rates.inputPerMtok === undefined) ||
    (tokens.completionTokens > 0 && rates.outputPerMtok === undefined)
  ) return undefined;

  const inputRate = rates.inputPerMtok ?? 0;
  const outputRate = rates.outputPerMtok ?? 0;
  const promptCost = (tokens.promptTokens * inputRate) / TOKENS_PER_MTOK;
  const completionCost = (tokens.completionTokens * outputRate) / TOKENS_PER_MTOK;
  const cacheReadCost = ((tokens.cacheReadTokens ?? 0) * inputRate * CACHE_READ_PRICE_MULTIPLIER) /
    TOKENS_PER_MTOK;
  const cacheCreationCost = ((tokens.cacheCreationTokens ?? 0) * inputRate) / TOKENS_PER_MTOK;

  return promptCost + completionCost + cacheReadCost + cacheCreationCost;
}
