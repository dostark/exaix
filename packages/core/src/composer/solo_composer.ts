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

import type { ICapabilityModule, IEditionComposer } from "./edition_composer.ts";

/**
 * Default Solo edition composer.
 * Accepts capability modules but applies no hooks (Solo has no paid features).
 * Kept for interface compatibility — the Team/Enterprise composers will
 * iterate registered modules and invoke each hook with concrete registries.
 */
export class SoloComposer implements IEditionComposer {
  private readonly modules: ICapabilityModule[] = [];

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
}
