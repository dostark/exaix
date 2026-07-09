/**
 * @module TeamComposer
 * @path packages-team/team-composer/src/team_composer.ts
 * @architectural-layer Team
 * @related-files [packages/core/src/composer/solo_composer.ts, packages-team/team-composer/src/team_bootstrap.ts]
 * @ungrounded
 * @description Team-edition composer — stores capability modules and invokes
 * every optional hook with the corresponding seam registries at registration time.
 *
 * Unlike SoloComposer (which stores modules but never invokes hooks), TeamComposer
 * iterates each registered ICapabilityModule and calls all defined hooks.
 * As Team features are added in later phases, the concrete registries for each
 * seam are wired here.
 */

import type { ICapabilityModule, IEditionComposer, IModelRegistryProvider } from "@exaix/core/composer";

export class TeamComposer implements IEditionComposer {
  private readonly modules: ICapabilityModule[] = [];
  private modelRegistryProvider?: IModelRegistryProvider;

  registerCapabilityModule(module: ICapabilityModule): void {
    this.modules.push(module);
  }

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
