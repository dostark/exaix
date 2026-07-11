/**
 * @module ModelRegistryLiveTeamPackage
 * @path packages-team/model-registry-live/mod.ts
 * @ungrounded
 * @related-files [packages/core/src/types/i_model_registry.ts]
 * @architectural-layer Team-ModelRegistry
 * @description Package entrypoint for @exaix-team/model-registry-live (Phase 135).
 *   The Team live model registry, its adapters, scheduler, route policies, and
 *   benchmark ingest. Team-only per D8; attaches to the daemon via the 134
 *   edition-composer hook.
 */
export { ModelRegistryService } from "./src/model_registry_service.ts";
export { OpenRouterCatalogAdapter } from "./src/adapters/openrouter_catalog_adapter.ts";
export { AdapterRegistry } from "./src/adapters/adapter_registry.ts";
export { admit } from "./src/adapters/admission.ts";
export type { AdmissionReason, IAdmissionInputs, IAdmittedEntry } from "./src/adapters/admission.ts";
export { TeamResolutionStrategy } from "./src/team_resolution_strategy.ts";
export type { ITeamStrategyDeps } from "./src/team_resolution_strategy.ts";
