/**
 * @module SoloComposer
 * @path packages/core/src/composer/solo_composer.ts
 * @architectural-layer Core
 * @related-files []
 * @description Solo-edition composer — the default composition hook with zero
 * capability modules. Every registered module's hooks are called at registration
 * time with the corresponding seam registries.
 *
 * Because the Solo edition ships no paid code, the SoloComposer is effectively
 * a no-op collection point. Team and Enterprise editions will create their own
 * composers (outside core) that pass concrete seam registries to each module.
 *
 * @ungrounded — solo composition is the default, not a standalone feature.
 */

import type { ICapabilityModule, IEditionComposer, IModelRegistryProvider } from "./edition_composer.ts";
import type { IAuthorizer } from "../authorizer/authorizer.ts";
import { AllowAllAuthorizer } from "../authorizer/authorizer.ts";

/**
 * Default Solo edition composer.
 * Accepts capability modules but applies no hooks (Solo has no paid features).
 * Holds a concrete AllowAllAuthorizer as the default entitlement seam.
 * Team/Enterprise composers will iterate registered modules and invoke each
 * hook with concrete registries.
 *
 * D8 seam: Solo stores a registry provider but always returns undefined from
 * getModelRegistryProvider. The Team composer (Phase 135) returns the provider
 * registered via registerModelRegistryProvider.
 */
export class SoloComposer implements IEditionComposer {
  private readonly modules: ICapabilityModule[] = [];
  private modelRegistryProvider?: IModelRegistryProvider;
  /** Default Solo authorizer — permits every action. */
  readonly authorizer: IAuthorizer = new AllowAllAuthorizer();

  registerCapabilityModule(module: ICapabilityModule): void {
    this.modules.push(module);
  }

  /**
   * Return the list of registered modules.
   * Useful for assertion tests and for the Team composer to delegate to.
   */
  getModules(): readonly ICapabilityModule[] {
    return this.modules;
  }

  registerModelRegistryProvider(provider: IModelRegistryProvider): void {
    this.modelRegistryProvider = provider;
  }

  getModelRegistryProvider(): IModelRegistryProvider | undefined {
    return this.modelRegistryProvider;
  }
}
