/**
 * @module ComposerBarrel
 * @path packages/core/src/composer/mod.ts
 * @architectural-layer Core
 * @ungrounded
 * @related-files []
 * @description Barrel export for edition-composition types (Phase 115 Step 6b).
 */

export { SoloComposer } from "./solo_composer.ts";
export * from "./capabilities.ts";
export type {
  ICapabilityModule,
  IEditionComposer,
  IModelRegistryProvider,
  IModelRegistryProviderDeps,
  ISeamRegistryPlaceholder,
} from "./edition_composer.ts";
