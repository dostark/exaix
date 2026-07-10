/**
 * @module IModelPricingLookup
 * @path packages/core/src/types/i_model_pricing_lookup.ts
 * @description Phase 135 Step 2 — the CostTracker↔registry seam. Core-owned so
 *   CostTracker never imports @exaix/model-registry (dependency direction): the
 *   daemon injects the edition-selected registry (Solo floor or Team live service)
 *   as an IModelPricingLookup via CostTracker.setPricingLookup.
 * @architectural-layer Core
 * @dependencies [packages/core/src/types/i_model_registry.ts]
 * @related-files [packages/core/src/cost/cost_tracker.ts]
 */
import type { IModelPricing } from "./i_model_registry.ts";

/** How a persisted cost was priced (provider_costs.cost_source). */
export type CostSource = "provider_reported" | "registry_computed";

/** Minimal pricing surface CostTracker needs — a subset of IModelRegistry. */
export interface IModelPricingLookup {
  getModelPricing(provider: string, model: string): Promise<IModelPricing>;
}
