/**
 * @module CostUnits
 * @path packages/model-registry/src/cost_units.ts
 * @description USD-per-million-tokens ↔ USD-per-1K-tokens conversion helpers (G1 convention).
 * @architectural-layer ModelRegistry
 * @related-files [packages/model-registry/src/default_model_registry.ts]
 */

/**
 * Convert USD per million tokens to per-1K-tokens.
 */
export function mtokToPer1k(perMtok: number): number {
  return perMtok / 1000;
}

/**
 * Convert USD per-1K-tokens to per million tokens.
 */
export function per1kToMtok(per1k: number): number {
  return per1k * 1000;
}
