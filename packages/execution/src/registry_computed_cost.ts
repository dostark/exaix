/**
 * @module RegistryComputedCost
 * @path packages/execution/src/registry_computed_cost.ts
 * @description Phase 140a Step 7 — re-prices ReActLoopStrategy/LegacyAgentStrategy's real,
 * already-measured token counts against static_overlay.ts's real per-model split price table,
 * instead of calculateCost()'s single flat blended per-provider rate. Distinct in kind from the
 * heuristic PRE-CALL output-token estimator GAP-23/24/25 removed from AgentOrchestrator: this
 * function only re-prices tokens a real API call already reported, never guesses at an unknown
 * quantity. cost_source remains "predicted" — this module never produces a tracked figure.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/strategies/legacy_strategy.ts, packages/model-registry/src/static_overlay.ts]
 */

import { getOverlayEntry } from "@exaix/model-registry";

export interface IRegistryPredictedCostTokens {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

const TOKENS_PER_MTOK = 1_000_000;
/** Anthropic's documented prompt-cache read discount: a cache hit costs 10% of the standard
 *  input price. https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching */
const CACHE_READ_PRICE_MULTIPLIER = 0.1;

/** Cache-creation tokens are priced at the standard input rate (no per-tier cache-write
 *  multiplier in the overlay table yet); cache-read tokens get the 0.1x discount. Returns
 *  undefined (never a fabricated figure) when the model has no overlay entry. */
export function computeRegistryPredictedCost(
  provider: string,
  model: string,
  tokens: IRegistryPredictedCostTokens,
): number | undefined {
  const overlay = getOverlayEntry(provider, model);
  if (!overlay || (overlay.inputPerMtok === undefined && overlay.outputPerMtok === undefined)) {
    return undefined;
  }

  const inputRate = overlay.inputPerMtok ?? 0;
  const outputRate = overlay.outputPerMtok ?? 0;
  const promptCost = (tokens.promptTokens * inputRate) / TOKENS_PER_MTOK;
  const completionCost = (tokens.completionTokens * outputRate) / TOKENS_PER_MTOK;
  const cacheReadCost = ((tokens.cacheReadTokens ?? 0) * inputRate * CACHE_READ_PRICE_MULTIPLIER) /
    TOKENS_PER_MTOK;
  const cacheCreationCost = ((tokens.cacheCreationTokens ?? 0) * inputRate) / TOKENS_PER_MTOK;

  return promptCost + completionCost + cacheReadCost + cacheCreationCost;
}
