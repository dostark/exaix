/**
 * @module ModelRegistryPackage
 * @path packages/model-registry/mod.ts
 * @description Package entrypoint for @exaix/model-registry. Exports the Solo-tier
 *   DefaultModelRegistry floor, static overlay, cost-unit helpers, and error types.
 * @architectural-layer ModelRegistry
 * @related-files [packages/model-registry/src/default_model_registry.ts]
 */
export { RegistryNotImplementedError } from "./src/errors.ts";
export type { IOverlayEntry, StaticOverlay } from "./src/static_overlay.ts";
export { STATIC_OVERLAY } from "./src/static_overlay.ts";
export { mtokToPer1k, per1kToMtok } from "./src/cost_units.ts";
export { DefaultModelRegistry } from "./src/default_model_registry.ts";
export { isCostExempt } from "./src/cost_exemption.ts";
