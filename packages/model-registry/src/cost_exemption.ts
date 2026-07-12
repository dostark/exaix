/**
 * @module CostExemption
 * @path packages/model-registry/src/cost_exemption.ts
 * @description D7 cost-exemption predicate. Used by CLI display and Phase 135 route policy.
 * @architectural-layer ModelRegistry
 * @related-files [packages/ai/src/routing/default_routing_strategy.ts, packages/ai/src/model_resolver.ts]
 */

import { ProviderCostTier } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Determine if a provider is cost-exempt.
 * Returns true when costTier ∈ {LOCAL, FREE} or when a genuine endpoint $0 price is detected.
 * Returns false for unknown provenance and paid tiers.
 */
export function isCostExempt(
  metadata?: Opt<{ costTier?: ProviderCostTier; costPerMtok?: number } | null, Reason.OptionalInput>,
  pricing?: Opt<{ costPerMtok?: number; provenance?: string } | null, Reason.OptionalInput>,
): boolean {
  if (!metadata) return false;

  if (metadata.costTier === ProviderCostTier.LOCAL) return true;
  if (metadata.costTier === ProviderCostTier.FREE) return true;

  if (pricing && pricing.costPerMtok === 0 && pricing.provenance === "endpoint") return true;

  return false;
}
